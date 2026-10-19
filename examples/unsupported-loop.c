extern int nondet_int(void);
extern void ERROR(void);

int main(void) {
    unsigned x = (unsigned)nondet_int();
    while (x > 0) x--;
    if (x != 0) ERROR();
    return 0;
}
