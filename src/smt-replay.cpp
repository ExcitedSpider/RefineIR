#include <z3++.h>
#include <iostream>
#include <fstream>
#include <iterator>
int main(int argc,char** argv) {
    if(argc!=2&&argc!=3)return 2;
    try {
        if(argc==3&&std::string(argv[1])=="--session") {
            std::ifstream input(argv[2]);if(!input)return 2;
            std::string script((std::istreambuf_iterator<char>(input)),std::istreambuf_iterator<char>());
            z3::context ctx;std::cout<<Z3_eval_smtlib2_string(ctx,script.c_str());return 0;
        }
        z3::context ctx;z3::solver solver(ctx);solver.set("timeout",5000u);
        solver.from_file(argv[1]);auto result=solver.check();
        std::cout<<result<<'\n';return result==z3::unknown?2:0;
    } catch(const z3::exception& error) {std::cerr<<error.msg()<<'\n';return 2;}
}
