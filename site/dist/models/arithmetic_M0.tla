---- MODULE arithmetic_M0 ----
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
    \/ Step("entry", "compute y", TRUE)
    \/ Step("compute y", "test x < 10", TRUE)
    \/ Step("test x < 10", "test y > 20", TRUE)
    \/ Step("test x < 10", "return", TRUE)
    \/ Step("test y > 20", "error after y > 20", TRUE)
    \/ Step("test y > 20", "return", TRUE)

TypeOK ==
    /\ pc \in {"entry", "compute y", "test x < 10", "test y > 20", "return", "error after y > 20"}

NoError == pc \notin {"error after y > 20"}

Spec == Init /\ [][Next]_vars
====
