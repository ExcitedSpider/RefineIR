#include "SVF-LLVM/SVFIRBuilder.h"
#include "SVF-LLVM/LLVMModule.h"
#include "Graphs/ICFG.h"
#include "llvm/IR/Instructions.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/raw_ostream.h"
#include <z3++.h>
#include <fstream>
#include <sstream>
#include <queue>
#include <map>
#include <set>
#include <functional>

using namespace SVF;
namespace j = llvm::json;
using ID = unsigned;

static std::string readFile(const std::string& path) {
    std::ifstream f(path); if (!f) throw std::runtime_error("Cannot read " + path);
    return std::string(std::istreambuf_iterator<char>(f), {});
}
static void save(const std::string& path, j::Object value) {
    std::error_code ec; llvm::raw_fd_ostream out(path, ec);
    if (ec) throw std::runtime_error(ec.message());
    out << llvm::formatv("{0:2}\n", j::Value(std::move(value)));
}

struct Edge {
    ID from, to; z3::expr guard; std::string label, formula;
    Edge(ID a, ID b, z3::expr g, std::string l, std::string f)
        : from(a), to(b), guard(g), label(l), formula(f) {}
};

class Checker {
    z3::context ctx;
    SVFIR* ir;
    LLVMModuleSet* modules;
    std::map<ID, const ICFGNode*> nodes;
    std::map<ID, const SVFStmt*> definitions;
    std::map<ID, z3::expr> values;
    std::map<ID, std::string> pretty;
    std::vector<std::pair<ID,z3::expr>> inputs;
    std::set<ID> resolving, errors;
    std::vector<Edge> edges;
    std::vector<z3::expr> predicates;
    std::vector<std::string> predicateNames;
    ID entry = 0;
    unsigned queries = 0;

    const llvm::Value* llvmValue(const SVFValue* v) const {
        return modules->hasLLVMValue(v) ? modules->getLLVMValue(v) : nullptr;
    }
    unsigned width(ID id) const {
        auto* v = llvmValue(ir->getSVFVar(id));
        if (!v || !v->getType()->isIntegerTy()) throw std::runtime_error("Non-integer SVF value " + std::to_string(id));
        return v->getType()->getIntegerBitWidth();
    }
    z3::check_result check(z3::expr expr) {
        ++queries; z3::solver s(ctx); s.set("timeout", 5000u); s.add(expr);
        auto r = s.check(); if (r == z3::unknown) throw std::runtime_error("Z3 returned UNKNOWN: " + s.reason_unknown());
        return r;
    }
    z3::expr expression(ID id) {
        auto found = values.find(id); if(found != values.end()) return found->second;
        auto* v = llvmValue(ir->getSVFVar(id));
        if (auto* c = llvm::dyn_cast_or_null<llvm::ConstantInt>(v)) {
            unsigned bits = c->getBitWidth();
            if(bits > 64) throw std::runtime_error("Integers wider than 64 bits are unsupported");
            pretty[id] = std::to_string(c->getSExtValue());
            return ctx.bv_val(c->getZExtValue(), bits);
        }
        if (!resolving.insert(id).second) throw std::runtime_error("Cyclic value definition");
        auto it = definitions.find(id);
        if(it == definitions.end()) throw std::runtime_error("Missing supported SVF definition for value " + std::to_string(id));
        auto* st = it->second;
        z3::expr result = ctx.bv_val(0, width(id));
        if(auto* c = SVFUtil::dyn_cast<CmpStmt>(st)) {
            auto a = expression(c->getOpVarID(0)), b = expression(c->getOpVarID(1));
            std::string op; z3::expr p = ctx.bool_val(false);
            switch(c->getPredicate()) {
                case CmpStmt::ICMP_EQ: p=a==b; op=" == "; break;
                case CmpStmt::ICMP_NE: p=a!=b; op=" != "; break;
                case CmpStmt::ICMP_SGT: p=a>b; op=" > "; break;
                case CmpStmt::ICMP_SGE: p=a>=b; op=" >= "; break;
                case CmpStmt::ICMP_SLT: p=a<b; op=" < "; break;
                case CmpStmt::ICMP_SLE: p=a<=b; op=" <= "; break;
                case CmpStmt::ICMP_UGT: p=z3::ugt(a,b); op=" >u "; break;
                case CmpStmt::ICMP_UGE: p=z3::uge(a,b); op=" >=u "; break;
                case CmpStmt::ICMP_ULT: p=z3::ult(a,b); op=" <u "; break;
                case CmpStmt::ICMP_ULE: p=z3::ule(a,b); op=" <=u "; break;
                default: throw std::runtime_error("Unsupported comparison");
            }
            result=z3::ite(p,ctx.bv_val(1,1),ctx.bv_val(0,1));
            pretty[id]=pretty[c->getOpVarID(0)]+op+pretty[c->getOpVarID(1)];
        } else if(auto* b = SVFUtil::dyn_cast<BinaryOPStmt>(st)) {
            auto a=expression(b->getOpVarID(0)), rhs=expression(b->getOpVarID(1));
            std::string op;
            switch(b->getOpcode()) {
                case BinaryOPStmt::Add: result=a+rhs; op=" + "; break;
                case BinaryOPStmt::Sub: result=a-rhs; op=" - "; break;
                case BinaryOPStmt::Mul: result=a*rhs; op=" * "; break;
                case BinaryOPStmt::And: result=a&rhs; op=" & "; break;
                case BinaryOPStmt::Or: result=a|rhs; op=" | "; break;
                case BinaryOPStmt::Xor: result=a^rhs; op=" ^ "; break;
                default: throw std::runtime_error("Unsupported arithmetic operation");
            }
            pretty[id]="("+pretty[b->getOpVarID(0)]+op+pretty[b->getOpVarID(1)]+")";
        } else if(auto* c = SVFUtil::dyn_cast<CopyStmt>(st)) {
            auto a=expression(c->getRHSVarID()); unsigned old=a.get_sort().bv_size(), dest=width(id);
            switch(c->getCopyKind()) {
                case CopyStmt::COPYVAL: case CopyStmt::BITCAST:
                    if(old!=dest) throw std::runtime_error("Unsupported copy width");
                    result=a; break;
                case CopyStmt::ZEXT: result=z3::zext(a,dest-old); break;
                case CopyStmt::SEXT: result=z3::sext(a,dest-old); break;
                case CopyStmt::TRUNC: result=a.extract(dest-1,0); break;
                default: throw std::runtime_error("Unsupported cast");
            }
            pretty[id]=pretty[c->getRHSVarID()];
        } else throw std::runtime_error("Unsupported SVF value definition");
        resolving.erase(id); values.emplace(id,result.simplify()); return result;
    }

    void validateInstruction(const ICFGNode* node) {
        auto* ins=llvm::dyn_cast_or_null<llvm::Instruction>(llvmValue(node));
        if(!ins) return;
        if(auto* b=llvm::dyn_cast<llvm::BinaryOperator>(ins)) {
            if(b->hasNoSignedWrap() || b->hasNoUnsignedWrap()) throw std::runtime_error("Poison-producing overflow flags are unsupported; compile with -fwrapv");
            switch(b->getOpcode()) {
                case llvm::Instruction::Add: case llvm::Instruction::Sub: case llvm::Instruction::Mul:
                case llvm::Instruction::And: case llvm::Instruction::Or: case llvm::Instruction::Xor: return;
                default: break;
            }
        } else if(llvm::isa<llvm::ICmpInst,llvm::BranchInst,llvm::ReturnInst>(ins)) return;
        else if(auto* c=llvm::dyn_cast<llvm::CastInst>(ins)) {
            if(c->getSrcTy()->isIntegerTy() && c->getDestTy()->isIntegerTy()) return;
        } else if(auto* c=llvm::dyn_cast<llvm::CallInst>(ins)) {
            auto* f=c->getCalledFunction();
            if(f && (f->getName()=="nondet_int" || f->getName()=="nondet_uint" || f->getName()=="ERROR")) {
                if(!f->isDeclaration() || c->arg_size()!=0) throw std::runtime_error("Demo intrinsics must be zero-argument declarations");
                if(f->getName()!="ERROR" && !c->getType()->isIntegerTy(32)) throw std::runtime_error("Nondeterministic input must be i32");
                if(f->getName()=="ERROR" && !c->getType()->isVoidTy()) throw std::runtime_error("ERROR must return void");
                return;
            }
        }
        throw std::runtime_error(std::string("Unsupported instruction: ")+ins->getOpcodeName()+". This prototype supports acyclic scalar programs without phi nodes or memory.");
    }

    z3::expr cube(unsigned mask) {
        auto p=ctx.bool_val(true);
        for(unsigned i=0;i<predicates.size();++i) p=p && ((mask&(1u<<i))?predicates[i]:!predicates[i]);
        return p;
    }
    j::Array names() { j::Array a; for(auto& p:predicateNames) a.push_back(p); return a; }

public:
    explicit Checker(SVFIR* p):ir(p),modules(LLVMModuleSet::getLLVMModuleSet()) {}
    j::Object run() {
        for(auto& pair:*ir->getICFG()) {
            auto* n=pair.second;
            if(!n->getFun() || n->getFun()->getName()!="main") continue;
            nodes[n->getId()]=n;
            if(SVFUtil::isa<FunEntryICFGNode>(n)) entry=n->getId();
        }
        if(!entry) throw std::runtime_error("No main function entry");
        auto* fn=llvm::dyn_cast_or_null<llvm::Function>(llvmValue(nodes.at(entry)->getFun()));
        if(fn && fn->arg_size()!=0) throw std::runtime_error("main arguments are unsupported");
        // Reject all unsupported instructions, even if their result is unused.
        for(auto [id,n]:nodes) validateInstruction(n);
        for(auto [id,n]:nodes) {
            if(auto* c=SVFUtil::dyn_cast<CallICFGNode>(n)) {
                auto* f=c->getCalledFunction();
                if(!f) throw std::runtime_error("Indirect calls are unsupported");
                if(f->getName()=="ERROR") errors.insert(id);
                else if(f->getName()=="nondet_int" || f->getName()=="nondet_uint") {
                    ID ret=c->getRetICFGNode()->getActualRet()->getId();
                    std::string name="input_"+std::to_string(inputs.size());
                    auto v=ctx.bv_const(name.c_str(),32); values.emplace(ret,v); pretty[ret]=name; inputs.emplace_back(id,v);
                }
            }
            for(auto* s:n->getSVFStmts()) {
                if(auto* m=SVFUtil::dyn_cast<MultiOpndStmt>(s)) definitions[m->getResID()]=s;
                else if(auto* c=SVFUtil::dyn_cast<CopyStmt>(s)) definitions[c->getLHSVarID()]=s;
                else if(!SVFUtil::isa<BranchStmt,RetPE,CallPE>(s)) throw std::runtime_error("Unsupported SVF statement: "+s->toString());
            }
        }
        for(auto [id,n]:nodes) for(auto* raw:n->getOutEdges()) {
            if(!nodes.count(raw->getDstID())) throw std::runtime_error("Interprocedural edges are unsupported");
            auto* e=SVFUtil::dyn_cast<IntraCFGEdge>(raw);
            if(!e) throw std::runtime_error("Non-intra ICFG edge");
            auto guard=ctx.bool_val(true); std::string label="", formula="true";
            if(auto* v=e->getCondition()) {
                auto cond=expression(v->getId());
                bool truth=e->getSuccessorCondValue()!=0;
                guard=(cond==ctx.bv_val(truth?1:0,cond.get_sort().bv_size())).simplify();
                label=truth?"true":"false"; formula=truth?pretty[v->getId()]:"not ("+pretty[v->getId()]+")";
            }
            edges.emplace_back(id,e->getDstID(),guard,label,formula);
        }
        std::map<ID,int> colors;
        std::function<void(ID)> visit=[&](ID n) {
            if(colors[n]==1) throw std::runtime_error("Loops are unsupported by this prototype");
            if(colors[n]==2) return;
            colors[n]=1; for(auto& e:edges) if(e.from==n) visit(e.to); colors[n]=2;
        }; visit(entry);
        j::Array nodeJson,edgeJson,inputJson;
        for(auto [id,n]:nodes) {
            j::Array statements; for(auto* s:n->getSVFStmts()) statements.push_back(s->toString());
            std::string raw=n->toString(); unsigned line=0;
            if(auto* i=llvm::dyn_cast_or_null<llvm::Instruction>(llvmValue(n))) {
                if(i->getDebugLoc()) line=i->getDebugLoc().getLine();
            }
            nodeJson.push_back(j::Object{{"id",id},{"line",line},{"raw",raw},{"statements",std::move(statements)},
                {"kind",errors.count(id)?"error":(id==entry?"entry":(SVFUtil::isa<FunExitICFGNode>(n)?"exit":(SVFUtil::isa<CallICFGNode>(n)?"input":"instruction")))}});
        }
        for(unsigned i=0;i<edges.size();++i) { auto& e=edges[i]; edgeJson.push_back(j::Object{{"id",i},{"from",e.from},{"to",e.to},{"label",e.label},{"formula",e.formula},{"smt",e.guard.to_string()}}); }
        for(auto& [id,v]:inputs) inputJson.push_back(j::Object{{"node",id},{"name",v.to_string()}});
        j::Array rounds; std::string verdict="UNKNOWN", reason="Predicate budget exhausted";
        for(unsigned round=0;round<9;++round) {
            using State=std::pair<ID,unsigned>;
            std::queue<State> pending; std::map<State,std::pair<State,int>> parent;
            unsigned masks=1u<<predicates.size();
            j::Array initialStates,transitions;
            for(unsigned m=0;m<masks;++m) if(check(cube(m))==z3::sat) {
                State s{entry,m}; parent[s]={s,-1}; pending.push(s);
                initialStates.push_back(j::Object{{"node",entry},{"valuation",m}});
            }
            bool reached=false; State target{}; j::Array explored,blocked;
            while(!pending.empty()) {
                State s=pending.front(); pending.pop();
                explored.push_back(j::Object{{"node",s.first},{"valuation",s.second}});
                // Keep the first counterexample, but finish reachability so the
                // presentation can display the complete reachable abstract model.
                // ERROR is a terminal observation, not a normal return edge.
                if(errors.count(s.first)) {
                    if(!reached) { reached=true; target=s; }
                    continue;
                }
                for(unsigned i=0;i<edges.size();++i) if(edges[i].from==s.first) {
                    auto& e=edges[i];
                    if(check(cube(s.second)&&e.guard)==z3::unsat) { blocked.push_back(j::Object{{"edge",i},{"valuation",s.second}}); continue; }
                    transitions.push_back(j::Object{{"edge",i},{"from",e.from},{"to",e.to},{"valuation",s.second}});
                    State next{e.to,s.second};
                    if(!parent.count(next)) { parent[next]={s,int(i)}; pending.push(next); }
                }
            }
            j::Object r{{"index",round},{"predicates",names()},{"explored",std::move(explored)},{"blocked",std::move(blocked)},
                {"initialStates",std::move(initialStates)},{"transitions",std::move(transitions)},{"modelComplete",true}};
            if(!reached) {
                verdict="SAFE"; reason="Complete abstract exploration found no reachable ERROR in the supported bit-vector model";
                r["outcome"]="safe"; rounds.push_back(std::move(r)); break;
            }
            std::vector<int> path; State cur=target;
            r["pathValuation"]=target.second;
            while(parent.at(cur).second!=-1) { path.push_back(parent.at(cur).second); cur=parent.at(cur).first; }
            std::reverse(path.begin(),path.end());
            j::Array pathJson,constraints; z3::solver solver(ctx), exported(ctx); solver.set("timeout",5000u);
            std::string assumptions;
            for(int i:path) {
                pathJson.push_back(i);
                if(!edges[i].label.empty()) {
                    auto tag="edge_"+std::to_string(i); solver.add(edges[i].guard,ctx.bool_const(tag.c_str()));
                    assumptions+=(assumptions.empty()?"":" ")+tag;
                    exported.add(edges[i].guard);
                    constraints.push_back(j::Object{{"edge",i},{"formula",edges[i].formula},{"smt",edges[i].guard.to_string()}});
                }
            }
            // Export untracked constraints so a standalone check-sat reproduces the
            // result (the internal core-tracking literals are implicit assumptions).
            r["path"]=std::move(pathJson); r["constraints"]=std::move(constraints); r["smtlib"]=exported.to_smt2();
            ++queries; auto sat=solver.check();
            // Serialize the actual tracked assertions, making the implicit
            // assert-and-track assumptions explicit for standalone replay.
            auto session=solver.to_smt2();
            auto command=session.rfind("(check-sat)");
            if(command==std::string::npos)throw std::runtime_error("Missing SMT check command");
            session.replace(command,11,"(check-sat-assuming ("+assumptions+"))");
            session="(set-option :produce-unsat-cores true)\n(set-option :timeout 5000)\n"+session;
            if(sat==z3::unsat)session+="(get-unsat-core)\n";
            r["z3Session"]=session;
            if(sat==z3::unknown) throw std::runtime_error("Path solver returned UNKNOWN");
            if(sat==z3::sat) {
                j::Array witness; auto model=solver.get_model();
                for(auto& [id,v]:inputs) {
                    uint64_t bits=model.eval(v,true).get_numeral_uint64();
                    witness.push_back(j::Object{{"input",v.to_string()},{"node",id},{"unsigned",int64_t(bits)},{"signed",int64_t(int32_t(bits))}});
                }
                r["outcome"]="sat"; r["witness"]=std::move(witness);
                verdict="UNSAFE"; reason="Z3 found an input reaching ERROR"; rounds.push_back(std::move(r)); break;
            }
            r["outcome"]="unsat";
            // Use only the SMT contradiction, never the first branch of the path.
            // Z3 cores need not be subset-minimal; minimize by deletion checks.
            std::set<std::string> tags; auto c=solver.unsat_core();
            std::string response="unsat\n(";
            j::Array reportedCore; for(unsigned i=0;i<c.size();++i) { tags.insert(c[i].to_string()); reportedCore.push_back(c[i].to_string()); response+=(i?" ":"")+c[i].to_string(); }
            r["z3Response"]=response+")";
            r["reportedCore"]=std::move(reportedCore);
            std::vector<int> conflict;
            for(int i:path) if(tags.count("edge_"+std::to_string(i))) conflict.push_back(i);
            auto conjunction=[&](const std::vector<int>& ids) {
                auto formula=ctx.bool_val(true); for(int i:ids) formula=formula&&edges[i].guard; return formula;
            };
            for(size_t k=0;k<conflict.size();) {
                auto trial=conflict; trial.erase(trial.begin()+k);
                if(check(conjunction(trial))==z3::unsat) conflict=std::move(trial); else ++k;
            }
            j::Array obligations;
            auto certify=[&](std::string purpose,z3::expr formula,z3::check_result expected) {
                if(check(formula)!=expected) throw std::runtime_error("Refinement certificate failed: "+purpose);
                z3::solver exportedProof(ctx); exportedProof.add(formula);
                obligations.push_back(j::Object{{"purpose",purpose},{"expected",expected==z3::unsat?"unsat":"sat"},{"smtlib",exportedProof.to_smt2()}});
            };
            certify("The selected core is inconsistent",conjunction(conflict),z3::unsat);
            for(size_t k=0;k<conflict.size();++k) {
                auto trial=conflict; trial.erase(trial.begin()+k);
                certify("Removing core constraint "+edges[conflict[k]].formula+" restores satisfiability",conjunction(trial),z3::sat);
            }
            j::Array core,coreConstraints,ignored,reductions,added,learned;
            for(int i:conflict) {
                core.push_back("edge_"+std::to_string(i));
                coreConstraints.push_back(j::Object{{"edge",i},{"formula",edges[i].formula}});
            }
            for(int i:path) if(!edges[i].label.empty()&&std::find(conflict.begin(),conflict.end(),i)==conflict.end())
                ignored.push_back(j::Object{{"edge",i},{"formula",edges[i].formula}});
            r["core"]=std::move(core);
            // Retain every core predicate modulo SMT-proved equivalence or
            // complementation. This may add several predicates in one round.
            std::vector<z3::expr> additions; std::vector<std::string> addedNames;
            for(int i:conflict) {
                auto candidate=edges[i].guard; bool represented=false;
                for(unsigned k=0;k<predicates.size()+additions.size();++k) {
                    auto existing=k<predicates.size()?predicates[k]:additions[k-predicates.size()];
                    auto name=k<predicates.size()?predicateNames[k]:addedNames[k-predicates.size()];
                    bool same=check(candidate!=existing)==z3::unsat;
                    bool opposite=!same&&check(candidate==existing)==z3::unsat;
                    if(!same&&!opposite) continue;
                    certify("Predicate "+edges[i].formula+(same?" is equivalent to ":" is the complement of ")+name,
                            same?candidate!=existing:candidate==existing,z3::unsat);
                    reductions.push_back(j::Object{{"formula",edges[i].formula},{"representative",name},{"relation",same?"equivalent":"complement"}});
                    represented=true;break;
                }
                if(!represented) {
                    additions.push_back(candidate);addedNames.push_back(edges[i].formula);
                    added.push_back(j::Object{{"edge",i},{"formula",edges[i].formula},{"smt",candidate.to_string()}});
                    learned.push_back(edges[i].formula);
                }
            }
            if(additions.empty()||predicates.size()+additions.size()>8) {
                reason="UNSAT-core refinement made no progress or reached the predicate budget";rounds.push_back(std::move(r));break;
            }
            for(unsigned k=0;k<additions.size();++k) {predicates.push_back(additions[k]);predicateNames.push_back(addedNames[k]);}
            r["learned"]=addedNames.front(); // Compatibility with older trace readers.
            r["learnedPredicates"]=std::move(learned);
            // A certificate covers every refined valuation: either the cube is
            // infeasible or one of the contradictory core guards is impossible.
            j::Array coverage;
            for(unsigned m=0;m<(1u<<predicates.size());++m) {
                auto valuation=cube(m);
                if(check(valuation)==z3::unsat) {
                    certify("Refined valuation "+std::to_string(m)+" is infeasible",valuation,z3::unsat);
                    coverage.push_back(j::Object{{"valuation",m},{"infeasible",true}});continue;
                }
                int blocker=-1;
                for(int i:conflict) if(check(valuation&&edges[i].guard)==z3::unsat) {blocker=i;break;}
                if(blocker<0)throw std::runtime_error("UNSAT-core refinement failed to eliminate the counterexample");
                certify("Refined valuation "+std::to_string(m)+" blocks "+edges[blocker].formula,valuation&&edges[blocker].guard,z3::unsat);
                coverage.push_back(j::Object{{"valuation",m},{"infeasible",false},{"blockedEdge",blocker}});
            }
            r["pathEliminated"]=true;
            r["refinement"]=j::Object{{"method","smt-unsat-core"},{"coreMinimal",true},{"core",std::move(coreConstraints)},
                {"ignored",std::move(ignored)},{"added",std::move(added)},{"reductions",std::move(reductions)},
                {"coverage",std::move(coverage)},{"obligations",std::move(obligations)}};
            rounds.push_back(std::move(r));
        }
        return j::Object{{"verdict",verdict},{"reason",reason},{"entry",entry},{"nodes",std::move(nodeJson)},
            {"edges",std::move(edgeJson)},{"inputs",std::move(inputJson)},{"rounds",std::move(rounds)},
            {"solverQueries",queries},{"z3Version",Z3_get_full_version()}};
    }
};

int main(int argc,char** argv) {
    if(argc!=4) { llvm::errs()<<"Usage: svf-cegar input.bc source.c output.json\n"; return 2; }
    j::Object result;
    try {
        LLVMModuleSet::buildSVFModule(std::vector<std::string>{argv[1]});
        SVFIRBuilder builder; auto* ir=builder.build();
        result=Checker(ir).run();
    } catch(const std::exception& e) { result=j::Object{{"verdict","UNKNOWN"},{"reason",std::string(e.what())},{"rounds",j::Array{}}}; }
    result["source"]=readFile(argv[2]); result["sourceFile"]=std::string(argv[2]);
    result["engine"]="SVF 3.4 + LLVM 21 + Z3; immutable-input predicate abstraction";
    save(argv[3],std::move(result));
    return 0;
}
