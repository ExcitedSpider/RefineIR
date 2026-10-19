extern int nondet_int(void);
extern void ERROR(void);

int main(void) {
    int x = nondet_int();
    if (x > 0) {
        if (x == 1) {
            ERROR();
        }
    }
    return 0;
}
