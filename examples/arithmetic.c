extern unsigned nondet_uint(void);
extern void ERROR(void);

int main(void) {
    unsigned x = nondet_uint();
    unsigned y = x + 1;
    if (x < 10) {
        if (y > 20) {
            ERROR();
        }
    }
    return 0;
}
