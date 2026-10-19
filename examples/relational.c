extern int nondet_int(void);
extern void ERROR(void);

int main(void) {
    int x = nondet_int();
    int y = nondet_int();
    if (x > y) {
        if (x <= y) {
            ERROR();
        }
    }
    return 0;
}
