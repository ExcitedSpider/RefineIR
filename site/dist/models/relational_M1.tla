---- MODULE relational_M1 ----
EXTENDS TLC

\* Recorded abstract model; pc denotes a displayed block end.
\* Straight-line steps collapsed. Predicates describe immutable inputs.
\* p0 represents: x > y

VARIABLES pc, p0
vars == <<pc, p0>>

Init ==
    /\ pc = "entry"
    /\ <<p0>> \in {<<FALSE>>, <<TRUE>>}

Step(from, to, enabled) ==
    /\ pc = from
    /\ enabled
    /\ pc' = to
    /\ UNCHANGED <<p0>>

Next ==
    \/ Step("entry", "test x > y", TRUE)
    \/ Step("test x > y", "test x <= y", p0)
    \/ Step("test x > y", "return", ~p0)
    \/ Step("test x <= y", "error after x <= y", FALSE)
    \/ Step("test x <= y", "return", p0)

TypeOK ==
    /\ pc \in {"entry", "test x > y", "test x <= y", "return", "error after x <= y"}
    /\ p0 \in BOOLEAN

NoError == pc \notin {"error after x <= y"}

Spec == Init /\ [][Next]_vars
====
