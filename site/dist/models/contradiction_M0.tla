---- MODULE contradiction_M0 ----
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
    \/ Step("test x > 0", "test x <= 0", TRUE)
    \/ Step("test x > 0", "return", TRUE)
    \/ Step("test x <= 0", "error after x <= 0", TRUE)
    \/ Step("test x <= 0", "return", TRUE)

TypeOK ==
    /\ pc \in {"entry", "test x > 0", "test x <= 0", "return", "error after x <= 0"}

NoError == pc \notin {"error after x <= 0"}

Spec == Init /\ [][Next]_vars
====
