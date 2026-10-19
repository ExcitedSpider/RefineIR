---- MODULE real_bug_M0 ----
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
    \/ Step("entry", "test x > 0", TRUE)
    \/ Step("test x > 0", "test x == 1", TRUE)
    \/ Step("test x > 0", "return", TRUE)
    \/ Step("test x == 1", "error after x == 1", TRUE)
    \/ Step("test x == 1", "return", TRUE)

TypeOK ==
    /\ pc \in {"entry", "test x > 0", "test x == 1", "return", "error after x == 1"}

NoError == pc \notin {"error after x == 1"}

Spec == Init /\ [][Next]_vars
====
