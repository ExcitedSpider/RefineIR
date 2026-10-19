---- MODULE relational_M0 ----
EXTENDS TLC

\* Recorded abstract model; pc denotes a displayed block end.
\* Straight-line steps collapsed. Predicates describe immutable inputs.

VARIABLES pc
vars == <<pc>>

Init ==
    /\ pc = "entry"

Step(from, to, enabled) ==
    /\ pc = from
    /\ enabled
    /\ pc' = to

Next ==
    \/ Step("entry", "test x > y", TRUE)
    \/ Step("test x > y", "test x <= y", TRUE)
    \/ Step("test x > y", "return", TRUE)
    \/ Step("test x <= y", "error after x <= y", TRUE)
    \/ Step("test x <= y", "return", TRUE)

TypeOK ==
    /\ pc \in {"entry", "test x > y", "test x <= y", "return", "error after x <= y"}

NoError == pc \notin {"error after x <= y"}

Spec == Init /\ [][Next]_vars
====
