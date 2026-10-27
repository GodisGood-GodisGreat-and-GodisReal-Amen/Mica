const EXAMPLES = {
counter: `; count from 1 to 5
MOV R1, 1
MOV R2, 5

loop:
OUT R1
INC R1
CMP R1, R2
JLE loop

HLT`,

fibonacci: `; print first 10 Fibonacci numbers
MOV R1, 0 ; a
MOV R2, 1 ; b
MOV R3, 10 ; counter

loop:
OUT R1
MOV R4, R1
ADD R4, R2 ; R4 = a + b
MOV R1, R2 ; a <- b
MOV R2, R4 ; b <- a+b
DEC R3
JNZ loop

HLT`,

factorial: `; recursive factorial: computes 5!
MOV R1, 5
CALL fact
OUT R1 ; -> 120
HLT

fact:
; computes R1 = R1!
CMP R1, 1
JLE base
PUSH R1
DEC R1
CALL fact
POP R2
MUL R1, R2
RET

base:
RET`,

multiply: `; multiply R1 * R2 via repeated addition -> R3
MOV R1, 7
MOV R2, 6
MOV R3, 0

loop:
CMP R2, 0
JEQ done
ADD R3, R1
DEC R2
JMP loop

done:
OUT R3 ; -> 42
HLT`,

memory: `; write three values into RAM, then read them back
STORE 100, 10
STORE 101, 20
STORE 102, 30

LOAD R1, 100
OUT R1
LOAD R1, 101
OUT R1
LOAD R1, 102
OUT R1

; you can also use memory indirect
MOV R2, 101
MOV R3, [R2] ; R3 <- mem[R2] = 20
OUT R3

HLT`,

bitwise: `; bitwise ops demo
MOV R1, 0b1100 ; 12
MOV R2, 0b1010 ; 10

MOV R3, R1
AND R3, R2
OUT R3 ; -> 8 (1000)

MOV R3, R1
OR R3, R2
OUT R3 ; -> 14 (1110)

MOV R3, R1
XOR R3, R2
OUT R3 ; -> 6 (0110)

MOV R3, R1
SHL R3, 2
OUT R3 ; -> 48 (110000)

HLT`,

kernel: `;; ============================================================
;; MSH — Mica Shell v1
;; ============================================================
;; A tiny REPL that runs as the Mica "kernel". On boot it prints
;; a banner, then waits for you to type single-character commands
;; at the TTY. Each command may prompt for further input. Press
;; 'q' (then Enter) to halt the system.
;;
;; It is an OS-style command loop: the "language" is the
;; vocabulary of single-char commands below.
;;
;; COMMAND VOCABULARY
;;
;; ARITHMETIC + - * / % two args
;; BITWISE & | ^ ~ (~ takes one arg, others take two)
;; SHIFT < > value, count
;; MATH ! f g factorial / N fibonaccis / gcd
;; IO b r o bases / random / raw echo
;; STATE = @ set/get variable (slot 0..9)
;; META ? q help / quit
;;
;; ARGUMENT FORMAT (anywhere IN appears)
;; decimal: 42 | hex: 0xFF | binary: 0b1010
;; char: 'A' (returns 65)
;;
;; EVERY OPCODE in Mica is reached through normal MSH use:
;; data movement MOV LOAD STORE
;; arithmetic ADD SUB MUL DIV MOD INC DEC
;; bitwise AND OR XOR NOT SHL SHR
;; comparison CMP
;; jumps JMP JEQ JNE JLT JGE JGT JLE
;; stack PUSH POP CALL RET
;; io OUT OUTC IN
;; control NOP HLT
;;
;; CONVENTIONS
;; args: R1 (R2 for second), R3/R4 callee-preserved
;; return: R1
;;
;; MEMORY MAP
;; 0x000..0x07F string scratch (per-command)
;; 0x100..0x107 sort buffer (used by 's')
;; 0x300..0x309 user variables (slot 0..9)
;; 0x380..0x38F kernel scratch (sort locals & count, MPL VM regs)
;; 0x3E0 RNG seed
;; 0x3F0..0x3FF stack region (grows down)
;;
;; vvv scroll to "main:" for the boot sequence vvv
;; ============================================================

CALL main
HLT

main:
CALL kinit
CALL print_banner
CALL print_welcome
CALL print_banner
CALL repl
RET

kinit:
MOV R1, 17
STORE 0x3E0, R1
RET

;; ============================================================
;; THE REPL
;; ============================================================
;; print prompt, read command char, dispatch, loop forever.
;; 'q' command issues HLT which exits the loop the hard way.

repl:
CALL print_prompt
IN R1
CALL dispatch
JMP repl

;; ============================================================
;; CHARACTER I/O
;; ============================================================

putc:
OUTC R1
RET

newline:
PUSH R1
MOV R1, 10
OUTC R1
POP R1
RET

space:
PUSH R1
MOV R1, 32
OUTC R1
POP R1
RET

;; puts(R1=addr) — print null-terminated string
puts:
PUSH R2
PUSH R3
MOV R3, R1
ps_lp:
LOAD R2, R3
CMP R2, 0
JEQ ps_end
OUTC R2
INC R3
JMP ps_lp
ps_end:
POP R3
POP R2
RET

;; ============================================================
;; NUMBER OUTPUT — printd / printh / printb
;; ============================================================

;; printd(R1) — decimal, handles 0 and negatives
printd:
PUSH R2
CMP R1, 0
JNE pd_nz
MOV R1, 48
OUTC R1
JMP pd_done
pd_nz:
JGE pd_pos
PUSH R1
MOV R1, 45
OUTC R1
POP R1
MOV R2, 0
SUB R2, R1
MOV R1, R2
pd_pos:
CALL pd_r
pd_done:
POP R2
RET

pd_r:
CMP R1, 0
JEQ pd_r_end
PUSH R1
MOV R2, 10
DIV R1, R2
CALL pd_r
POP R1
MOV R2, 10
MOD R1, R2
ADD R1, 48
OUTC R1
pd_r_end:
RET

;; printh(R1) — non-negative hex
printh:
PUSH R2
CMP R1, 0
JNE ph_nz
MOV R1, 48
OUTC R1
JMP ph_done
ph_nz:
CALL ph_r
ph_done:
POP R2
RET

ph_r:
CMP R1, 0
JEQ ph_end
PUSH R1
MOV R2, 16
DIV R1, R2
CALL ph_r
POP R1
MOV R2, 16
MOD R1, R2
CMP R1, 10
JGE ph_letter
ADD R1, 48
JMP ph_emit
ph_letter:
ADD R1, 55
ph_emit:
OUTC R1
ph_end:
RET

;; printb(R1) — non-negative binary
printb:
PUSH R2
CMP R1, 0
JNE pb_nz
MOV R1, 48
OUTC R1
JMP pb_done
pb_nz:
CALL pb_r
pb_done:
POP R2
RET

pb_r:
CMP R1, 0
JEQ pb_end
PUSH R1
MOV R2, 2
DIV R1, R2
CALL pb_r
POP R1
MOV R2, 2
MOD R1, R2
ADD R1, 48
OUTC R1
pb_end:
RET

;; ============================================================
;; MATH
;; ============================================================

;; gcd(R1, R2) -> R1
gcd:
PUSH R3
gcd_lp:
CMP R2, 0
JEQ gcd_end
MOV R3, R1
MOD R3, R2
MOV R1, R2
MOV R2, R3
JMP gcd_lp
gcd_end:
POP R3
RET

;; factorial(R1) -> R1
factorial:
CMP R1, 1
JLE fact_end
PUSH R1
DEC R1
CALL factorial
POP R2
MUL R1, R2
fact_end:
RET

;; ============================================================
;; RANDOM — LCG
;; ============================================================

rand:
LOAD R1, 0x3E0
MUL R1, 13
ADD R1, 7
AND R1, 127
STORE 0x3E0, R1
RET

srand:
STORE 0x3E0, R1
RET

;; nop_delay — used between random outputs to give the CPU a tiny
;; "thinking" pause. The NOPs do nothing per cycle, which is the
;; point — they exercise the NOP opcode.
nop_delay:
PUSH R1
MOV R1, 10
nd_lp:
NOP
NOP
NOP
DEC R1
JNZ nd_lp
POP R1
RET

;; ============================================================
;; SORT — bubble sort + array print
;; ============================================================

;; print_array(R1=start, R2=count) — space-separated, no trailing space
print_array:
PUSH R2
PUSH R3
PUSH R4
MOV R3, R1
MOV R4, R2
pa_loop:
CMP R4, 0
JEQ pa_end
LOAD R1, R3
CALL printd
CMP R4, 1
JEQ pa_no_space
CALL space
pa_no_space:
INC R3
DEC R4
JMP pa_loop
pa_end:
POP R4
POP R3
POP R2
RET

;; bubble_sort(R1=start, R2=count) — uses 0x380..0x382 as locals
bubble_sort:
STORE 0x380, R1
STORE 0x381, R2
MOV R3, 0
STORE 0x382, R3
bs_outer:
LOAD R1, 0x382
LOAD R2, 0x381
CMP R1, R2
JGE bs_done
LOAD R3, 0x380
bs_inner:
LOAD R1, 0x380
LOAD R2, 0x381
ADD R1, R2
DEC R1
CMP R3, R1
JGE bs_inner_done
LOAD R1, R3
INC R3
LOAD R2, R3
DEC R3
CMP R1, R2
JLE bs_no_swap
STORE R3, R2
INC R3
STORE R3, R1
DEC R3
bs_no_swap:
INC R3
JMP bs_inner
bs_inner_done:
LOAD R1, 0x382
INC R1
STORE 0x382, R1
JMP bs_outer
bs_done:
RET

;; ============================================================
;; SHELL UI HELPERS
;; ============================================================

;; print_banner — 44 '=' chars + newline
print_banner:
PUSH R1
PUSH R2
MOV R2, 44
MOV R1, 61
pbn_lp:
OUTC R1
DEC R2
JNZ pbn_lp
POP R2
POP R1
CALL newline
RET

;; print_welcome — two lines describing the shell
print_welcome:
; "    MSH - Mica Shell v1"
STORE 0, 32
STORE 1, 32
STORE 2, 32
STORE 3, 32
STORE 4, 77
STORE 5, 83
STORE 6, 72
STORE 7, 32
STORE 8, 45
STORE 9, 32
STORE 10, 77
STORE 11, 105
STORE 12, 99
STORE 13, 97
STORE 14, 32
STORE 15, 83
STORE 16, 104
STORE 17, 101
STORE 18, 108
STORE 19, 108
STORE 20, 32
STORE 21, 118
STORE 22, 49
STORE 23, 0
MOV R1, 0
CALL puts
CALL newline
; " type ? for help, q to quit"
STORE 0, 32
STORE 1, 32
STORE 2, 32
STORE 3, 32
STORE 4, 116
STORE 5, 121
STORE 6, 112
STORE 7, 101
STORE 8, 32
STORE 9, 63
STORE 10, 32
STORE 11, 102
STORE 12, 111
STORE 13, 114
STORE 14, 32
STORE 15, 104
STORE 16, 101
STORE 17, 108
STORE 18, 112
STORE 19, 44
STORE 20, 32
STORE 21, 113
STORE 22, 32
STORE 23, 116
STORE 24, 111
STORE 25, 32
STORE 26, 113
STORE 27, 117
STORE 28, 105
STORE 29, 116
STORE 30, 0
MOV R1, 0
CALL puts
CALL newline
RET

;; print_prompt — "msh> "
print_prompt:
STORE 0, 109
STORE 1, 115
STORE 2, 104
STORE 3, 62
STORE 4, 32
STORE 5, 0
MOV R1, 0
CALL puts
RET

;; print_eq(R1) — " = " then printd(R1) + newline
print_eq:
PUSH R1
STORE 0, 32
STORE 1, 32
STORE 2, 61
STORE 3, 32
STORE 4, 0
MOV R1, 0
CALL puts
POP R1
CALL printd
CALL newline
RET

;; ask_a — prompt " a: " and IN into R1
ask_a:
STORE 0, 32
STORE 1, 32
STORE 2, 97
STORE 3, 58
STORE 4, 32
STORE 5, 0
MOV R1, 0
CALL puts
IN R1
RET

;; ask_b — prompt " b: " and IN into R1
ask_b:
STORE 0, 32
STORE 1, 32
STORE 2, 98
STORE 3, 58
STORE 4, 32
STORE 5, 0
MOV R1, 0
CALL puts
IN R1
RET

;; ask_n — prompt " n: " and IN into R1
ask_n:
STORE 0, 32
STORE 1, 32
STORE 2, 110
STORE 3, 58
STORE 4, 32
STORE 5, 0
MOV R1, 0
CALL puts
IN R1
RET

;; ask_two — read a into R1, b into R2 (preserves R3)
ask_two:
PUSH R3
CALL ask_a
MOV R3, R1
CALL ask_b
MOV R2, R1
MOV R1, R3
POP R3
RET

;; print_unknown — for unrecognised commands
print_unknown:
STORE 0, 32
STORE 1, 32
STORE 2, 63
STORE 3, 32
STORE 4, 117
STORE 5, 110
STORE 6, 107
STORE 7, 110
STORE 8, 111
STORE 9, 119
STORE 10, 110
STORE 11, 32
STORE 12, 40
STORE 13, 63
STORE 14, 32
STORE 15, 102
STORE 16, 111
STORE 17, 114
STORE 18, 32
STORE 19, 104
STORE 20, 101
STORE 21, 108
STORE 22, 112
STORE 23, 41
STORE 24, 0
MOV R1, 0
CALL puts
CALL newline
RET

;; print_slot_err — bad slot number for = or @
print_slot_err:
STORE 0, 32
STORE 1, 32
STORE 2, 33
STORE 3, 32
STORE 4, 115
STORE 5, 108
STORE 6, 111
STORE 7, 116
STORE 8, 32
STORE 9, 109
STORE 10, 117
STORE 11, 115
STORE 12, 116
STORE 13, 32
STORE 14, 98
STORE 15, 101
STORE 16, 32
STORE 17, 48
STORE 18, 46
STORE 19, 46
STORE 20, 57
STORE 21, 0
MOV R1, 0
CALL puts
CALL newline
RET

;; ============================================================
;; DISPATCHER — single-char command lookup
;; ============================================================
;; This is the heart of MSH. After IN reads a char into R1, we
;; CMP+JEQ against every known opcode. Unknown -> print_unknown.

dispatch:
CMP R1, 43
JEQ d_add
CMP R1, 45
JEQ d_sub
CMP R1, 42
JEQ d_mul
CMP R1, 47
JEQ d_div
CMP R1, 37
JEQ d_mod
CMP R1, 38
JEQ d_and
CMP R1, 124
JEQ d_or
CMP R1, 94
JEQ d_xor
CMP R1, 126
JEQ d_not
CMP R1, 60
JEQ d_shl
CMP R1, 62
JEQ d_shr
CMP R1, 33
JEQ d_fact
CMP R1, 102
JEQ d_fib
CMP R1, 103
JEQ d_gcd
CMP R1, 98
JEQ d_bases
CMP R1, 115
JEQ d_sort
CMP R1, 114
JEQ d_rand
CMP R1, 111
JEQ d_echo
CMP R1, 61
JEQ d_set
CMP R1, 64
JEQ d_get
CMP R1, 63
JEQ d_help
CMP R1, 113
JEQ d_quit
CMP R1, 112 ; 'p' - enter MPL program
JEQ d_program
CMP R1, 120 ; 'x' - execute MPL program
JEQ d_execute
CMP R1, 99 ; 'c' - clear MPL program
JEQ d_clear
CMP R1, 108 ; 'l' - list MPL program
JEQ d_list
CALL print_unknown
RET

;; ============================================================
;; COMMAND HANDLERS
;; ============================================================

;; --- arithmetic ---

d_add:
CALL ask_two
ADD R1, R2
CALL print_eq
RET

d_sub:
CALL ask_two
SUB R1, R2
CALL print_eq
RET

d_mul:
CALL ask_two
MUL R1, R2
CALL print_eq
RET

d_div:
CALL ask_two
CMP R2, 0
JEQ d_div_zero
DIV R1, R2
CALL print_eq
RET
d_div_zero:
STORE 0, 32
STORE 1, 32
STORE 2, 33
STORE 3, 32
STORE 4, 100
STORE 5, 105
STORE 6, 118
STORE 7, 47
STORE 8, 48
STORE 9, 0
MOV R1, 0
CALL puts
CALL newline
RET

d_mod:
CALL ask_two
CMP R2, 0
JEQ d_div_zero
MOD R1, R2
CALL print_eq
RET

;; --- bitwise ---

d_and:
CALL ask_two
AND R1, R2
CALL print_eq
RET

d_or:
CALL ask_two
OR R1, R2
CALL print_eq
RET

d_xor:
CALL ask_two
XOR R1, R2
CALL print_eq
RET

d_not:
CALL ask_n
NOT R1
CALL print_eq
RET

d_shl:
CALL ask_two
SHL R1, R2
CALL print_eq
RET

d_shr:
CALL ask_two
SHR R1, R2
CALL print_eq
RET

;; --- math ---

;; factorial, clamped to 0..8 to keep the recursive stack happy
d_fact:
CALL ask_n
CMP R1, 8
JLE df_lo
MOV R1, 8
df_lo:
CMP R1, 0
JGE df_run
MOV R1, 0
df_run:
CALL factorial
CALL print_eq
RET

;; first N fibonaccis, clamped to 0..15
d_fib:
CALL ask_n
CMP R1, 15
JLE dfib_lo
MOV R1, 15
dfib_lo:
CMP R1, 0
JGT dfib_run
MOV R1, 0
CALL print_eq
RET
dfib_run:
MOV R3, R1
STORE 0, 32
STORE 1, 32
STORE 2, 61
STORE 3, 32
STORE 4, 0
MOV R1, 0
CALL puts
MOV R1, 0
MOV R2, 1
dfib_lp:
PUSH R1
PUSH R2
PUSH R3
CALL printd
CALL space
POP R3
POP R2
POP R1
PUSH R2
ADD R2, R1
POP R1
DEC R3
JNZ dfib_lp
CALL newline
RET

d_gcd:
CALL ask_two
CALL gcd
CALL print_eq
RET

;; --- io ---

;; print the number in three bases
d_bases:
CALL ask_n
PUSH R1
; " dec: "
STORE 0, 32
STORE 1, 32
STORE 2, 100
STORE 3, 101
STORE 4, 99
STORE 5, 58
STORE 6, 32
STORE 7, 0
MOV R1, 0
CALL puts
POP R1
PUSH R1
CALL printd
CALL newline
; " hex: 0x"
STORE 0, 32
STORE 1, 32
STORE 2, 104
STORE 3, 101
STORE 4, 120
STORE 5, 58
STORE 6, 32
STORE 7, 48
STORE 8, 120
STORE 9, 0
MOV R1, 0
CALL puts
POP R1
PUSH R1
CALL printh
CALL newline
; " bin: 0b"
STORE 0, 32
STORE 1, 32
STORE 2, 98
STORE 3, 105
STORE 4, 110
STORE 5, 58
STORE 6, 32
STORE 7, 48
STORE 8, 98
STORE 9, 0
MOV R1, 0
CALL puts
POP R1
CALL printb
CALL newline
RET

;; print 3 random numbers with NOP delays
d_rand:
STORE 0, 32
STORE 1, 32
STORE 2, 61
STORE 3, 32
STORE 4, 0
MOV R1, 0
CALL puts
MOV R3, 3
dr_lp:
CALL rand
PUSH R3
CALL printd
CALL space
CALL nop_delay
POP R3
DEC R3
JNZ dr_lp
CALL newline
RET

;; echo: read a value and print it back via raw OUT
d_echo:
STORE 0, 32
STORE 1, 32
STORE 2, 105
STORE 3, 110
STORE 4, 58
STORE 5, 32
STORE 6, 0
MOV R1, 0
CALL puts
IN R1
PUSH R1
STORE 0, 32
STORE 1, 32
STORE 2, 61
STORE 3, 32
STORE 4, 0
MOV R1, 0
CALL puts
POP R1
OUT R1
RET

;; sort up to 8 numbers (uses bubble_sort + print_array)
d_sort:
STORE 0, 32
STORE 1, 32
STORE 2, 99
STORE 3, 111
STORE 4, 117
STORE 5, 110
STORE 6, 116
STORE 7, 58
STORE 8, 32
STORE 9, 0
MOV R1, 0
CALL puts
IN R1
CMP R1, 8
JLE ds_cap
MOV R1, 8
ds_cap:
CMP R1, 1
JGE ds_run
RET
ds_run:
STORE 0x38F, R1 ; count — scratch at 0x38F (0x300..0x309 are the user var slots!)
MOV R3, R1
MOV R4, 0x100
ds_read:
CMP R3, 0
JEQ ds_done_read
STORE 0, 32
STORE 1, 32
STORE 2, 118
STORE 3, 58
STORE 4, 32
STORE 5, 0
PUSH R3
PUSH R4
MOV R1, 0
CALL puts
POP R4
POP R3
IN R1
STORE R4, R1
INC R4
DEC R3
JMP ds_read
ds_done_read:
MOV R1, 0x100
LOAD R2, 0x38F
CALL bubble_sort
STORE 0, 32
STORE 1, 32
STORE 2, 61
STORE 3, 32
STORE 4, 0
MOV R1, 0
CALL puts
MOV R1, 0x100
LOAD R2, 0x38F
CALL print_array
CALL newline
RET

;; --- state: variable slots ---
;; Slots 0..9 map to memory cells 0x300..0x309.

d_set:
STORE 0, 32
STORE 1, 32
STORE 2, 115
STORE 3, 108
STORE 4, 111
STORE 5, 116
STORE 6, 58
STORE 7, 32
STORE 8, 0
MOV R1, 0
CALL puts
IN R1
CMP R1, 0
JLT d_slot_err
CMP R1, 9
JGT d_slot_err
ADD R1, 0x300
PUSH R1
STORE 0, 32
STORE 1, 32
STORE 2, 118
STORE 3, 97
STORE 4, 108
STORE 5, 117
STORE 6, 101
STORE 7, 58
STORE 8, 32
STORE 9, 0
MOV R1, 0
CALL puts
IN R1
POP R2
STORE R2, R1
STORE 0, 32
STORE 1, 32
STORE 2, 111
STORE 3, 107
STORE 4, 0
MOV R1, 0
CALL puts
CALL newline
RET

d_get:
STORE 0, 32
STORE 1, 32
STORE 2, 115
STORE 3, 108
STORE 4, 111
STORE 5, 116
STORE 6, 58
STORE 7, 32
STORE 8, 0
MOV R1, 0
CALL puts
IN R1
CMP R1, 0
JLT d_slot_err
CMP R1, 9
JGT d_slot_err
ADD R1, 0x300
LOAD R1, R1
CALL print_eq
RET

d_slot_err:
CALL print_slot_err
RET

;; --- meta ---

d_help:
CALL print_help
RET

d_quit:
STORE 0, 98
STORE 1, 121
STORE 2, 101
STORE 3, 33
STORE 4, 0
MOV R1, 0
CALL puts
CALL newline
HLT

;; ============================================================
;; MPL — Mica Programming Language
;; ============================================================
;; A tiny stack-based VM that lives inside the kernel. MSH's 'p'
;; command lets you enter a program (each cell is one instruction
;; value), 'x' executes it, 'c' clears it, 'l' lists it.
;;
;; MEMORY LAYOUT (MPL section)
;; 0x080..0x17F program memory (256 cells max)
;; 0x180..0x1FF data stack (grows up from 0x180)
;; 0x383 VM_PC
;; 0x384 VM_SP (points to next free slot)
;; 0x385 VM_PROG_LEN
;; 0x386 VM_HALT flag
;;
;; INSTRUCTION SET — single-cell unless noted
;;
;; 0..9 push that digit
;; + - * / pop b, pop a, push (a op b)
;; = equal: push 1 if a==b else 0
;; ? less-than: push 1 if a<b else 0
;; d dup top
;; D drop top
;; s swap top two
;; @ pop addr, push memory[addr]
;; ! pop val, pop addr, store val at addr
;; . pop, print as decimal + space
;; , pop, print as ASCII char
;; ; newline
;; H halt program (return to MSH)
;; r random 0..127, push
;; R IN, push value
;; S print stack contents as "[a b c]" — NON-DESTRUCTIVE,
;; for debugging
;;
;; TWO-CELL instructions read their argument from program[PC+1]:
;; P n push literal n
;; J n unconditional jump to n
;; Z n pop; jump to n if value was 0
;; U n pop; jump to n if value was non-zero
;;
;; Anything unrecognised is silently skipped (PC++).
;;
;; STACK SAFETY: push past 0x1FF is dropped silently. Pop from an
;; empty stack returns 0 (FORTH convention). So a buggy program
;; misbehaves but doesn't corrupt anything outside the VM region.
;;
;; WORKED EXAMPLE — print 1 through 5 with newlines.
;; length: 12 cells listed left-to-right:
;;
;; index cell meaning stack after
;; ----- ---- ----------------- -----------
;; 0 1 push 1 [1]
;; 1 d dup <-- LOOP [i, i]
;; 2 . print top [i] prints "i "
;; 3 ; newline [i]
;; 4 1 push 1 [i, 1]
;; 5 + add [i+1]
;; 6 d dup [i+1, i+1]
;; 7 6 push 6 [i+1, i+1, 6]
;; 8 ? i+1 < 6 ? (0 or 1) [i+1, flag]
;; 9 U jump-if-nonzero --> [i+1]
;; 10 1 ...to cell 1
;; 11 H halt
;;
;; To type this in: msh> p / length: 12 / enter the 12 cells
;; To run it: msh> x
;; To see it: msh> l

;; --- MSH commands for MPL ---

;; d_program: ask for length, then read that many cells into 0x080+
d_program:
STORE 0, 32
STORE 1, 32
STORE 2, 108
STORE 3, 101
STORE 4, 110
STORE 5, 103
STORE 6, 116
STORE 7, 104
STORE 8, 58
STORE 9, 32
STORE 10, 0
MOV R1, 0
CALL puts
IN R1
CMP R1, 0
JLE dp_bad
CMP R1, 256
JLE dp_lenok
MOV R1, 256
dp_lenok:
STORE 0x385, R1
MOV R3, 0
dp_loop:
LOAD R1, 0x385
CMP R3, R1
JGE dp_done
STORE 0, 32
STORE 1, 32
STORE 2, 62
STORE 3, 32
STORE 4, 0
PUSH R3
MOV R1, 0
CALL puts
POP R3
IN R1
MOV R4, R3
ADD R4, 128
STORE R4, R1
INC R3
JMP dp_loop
dp_done:
STORE 0, 32
STORE 1, 32
STORE 2, 108
STORE 3, 111
STORE 4, 97
STORE 5, 100
STORE 6, 101
STORE 7, 100
STORE 8, 46
STORE 9, 0
MOV R1, 0
CALL puts
CALL newline
RET
dp_bad:
CALL print_unknown
RET

;; d_execute: run the stored MPL program
d_execute:
LOAD R1, 0x385
CMP R1, 0
JEQ de_empty
CALL vm_run
STORE 0, 32
STORE 1, 32
STORE 2, 104
STORE 3, 97
STORE 4, 108
STORE 5, 116
STORE 6, 101
STORE 7, 100
STORE 8, 46
STORE 9, 0
MOV R1, 0
CALL puts
CALL newline
RET
de_empty:
STORE 0, 32
STORE 1, 32
STORE 2, 40
STORE 3, 110
STORE 4, 111
STORE 5, 32
STORE 6, 112
STORE 7, 114
STORE 8, 111
STORE 9, 103
STORE 10, 114
STORE 11, 97
STORE 12, 109
STORE 13, 41
STORE 14, 0
MOV R1, 0
CALL puts
CALL newline
RET

;; d_clear: zero out the program length
d_clear:
MOV R1, 0
STORE 0x385, R1
STORE 0, 32
STORE 1, 32
STORE 2, 99
STORE 3, 108
STORE 4, 101
STORE 5, 97
STORE 6, 114
STORE 7, 101
STORE 8, 100
STORE 9, 46
STORE 10, 0
MOV R1, 0
CALL puts
CALL newline
RET

;; d_list: print each cell. Printable ASCII -> as char, else [n]
d_list:
LOAD R1, 0x385
CMP R1, 0
JNE dl_show
STORE 0, 32
STORE 1, 32
STORE 2, 40
STORE 3, 101
STORE 4, 109
STORE 5, 112
STORE 6, 116
STORE 7, 121
STORE 8, 41
STORE 9, 0
MOV R1, 0
CALL puts
CALL newline
RET
dl_show:
STORE 0, 32
STORE 1, 32
STORE 2, 0
PUSH R1
MOV R1, 0
CALL puts
POP R3
MOV R4, 0
dl_loop:
CMP R4, R3
JGE dl_done
MOV R1, R4
ADD R1, 128
LOAD R1, R1
CMP R1, 32
JLT dl_num
CMP R1, 126
JGT dl_num
OUTC R1
JMP dl_next
dl_num:
PUSH R1
MOV R1, 91
OUTC R1
POP R1
PUSH R3
PUSH R4
CALL printd
POP R4
POP R3
MOV R1, 93
OUTC R1
dl_next:
INC R4
JMP dl_loop
dl_done:
CALL newline
RET

;; ============================================================
;; VM HELPERS — push, pop, advance, fetch_arg, jump, halt
;; ============================================================

;; vm_push(R1): write R1 at memory[SP], SP++
vm_push:
PUSH R2
LOAD R2, 0x384
CMP R2, 0x200 ; stack ends at 0x1FF — SP=0x200 means full
JGE vp_full
STORE R2, R1
INC R2
STORE 0x384, R2
vp_full:
POP R2
RET

;; vm_pop -> R1: SP--, R1 = memory[SP]. Empty stack returns 0.
vm_pop:
PUSH R2
LOAD R2, 0x384
CMP R2, 0x180 ; SP=0x180 means empty
JLE vp_empty
DEC R2
STORE 0x384, R2
LOAD R1, R2
POP R2
RET
vp_empty:
POP R2
MOV R1, 0 ; empty pop → zero, like FORTH
RET

;; vm_advance: PC++
vm_advance:
PUSH R1
LOAD R1, 0x383
INC R1
STORE 0x383, R1
POP R1
RET

;; vm_advance2: PC += 2 (for 2-cell instructions)
vm_advance2:
PUSH R1
LOAD R1, 0x383
ADD R1, 2
STORE 0x383, R1
POP R1
RET

;; vm_fetch_arg -> R1: read program[PC+1]
vm_fetch_arg:
LOAD R1, 0x383
INC R1
ADD R1, 128
LOAD R1, R1
RET

;; vm_jump(R1=target): PC = R1
vm_jump:
STORE 0x383, R1
RET

;; vm_halt: set halt flag
vm_halt:
PUSH R1
MOV R1, 1
STORE 0x386, R1
POP R1
RET

;; ============================================================
;; VM MAIN LOOP
;; ============================================================

vm_run:
MOV R1, 0
STORE 0x383, R1 ; PC = 0
STORE 0x386, R1 ; halted = 0
MOV R1, 0x180
STORE 0x384, R1 ; SP = stack base

vm_loop:
LOAD R1, 0x386
CMP R1, 0
JNE vm_done
LOAD R1, 0x383
LOAD R2, 0x385
CMP R1, R2
JGE vm_done
ADD R1, 128
LOAD R1, R1
CALL vm_dispatch
JMP vm_loop
vm_done:
RET

;; ============================================================
;; VM DISPATCH — CMP chain on opcode in R1
;; ============================================================

vm_dispatch:
; Numeric 0..9 — push value directly (user can type "5" and have it
; work as expected, rather than needing the ASCII form '5'/53).
CMP R1, 0
JLT vm_d_chk
CMP R1, 9
JGT vm_d_chk_ascii
CALL vm_push
CALL vm_advance
RET
vm_d_chk_ascii:
; ASCII '0'..'9' — push (R1 - 48). Lets pasted source like "53" work.
CMP R1, 48
JLT vm_d_chk
CMP R1, 57
JGT vm_d_chk
SUB R1, 48
CALL vm_push
CALL vm_advance
RET
vm_d_chk:
CMP R1, 43
JEQ vm_op_add
CMP R1, 45
JEQ vm_op_sub
CMP R1, 42
JEQ vm_op_mul
CMP R1, 47
JEQ vm_op_div
CMP R1, 61
JEQ vm_op_eq
CMP R1, 63
JEQ vm_op_lt
CMP R1, 100
JEQ vm_op_dup
CMP R1, 68
JEQ vm_op_drop
CMP R1, 115
JEQ vm_op_swap
CMP R1, 64
JEQ vm_op_load
CMP R1, 33
JEQ vm_op_store
CMP R1, 46
JEQ vm_op_pd
CMP R1, 44
JEQ vm_op_pc
CMP R1, 59
JEQ vm_op_nl
CMP R1, 72
JEQ vm_op_halt
CMP R1, 114
JEQ vm_op_rand
CMP R1, 82
JEQ vm_op_in
CMP R1, 83
JEQ vm_op_pstack
CMP R1, 80
JEQ vm_op_pushlit
CMP R1, 74
JEQ vm_op_jmp
CMP R1, 90
JEQ vm_op_jz
CMP R1, 85
JEQ vm_op_jnz
CALL vm_advance
RET

;; ============================================================
;; VM HANDLERS
;; ============================================================

;; Arithmetic — convention: pop b, pop a, push (a op b)

vm_op_add:
CALL vm_pop
MOV R3, R1
CALL vm_pop
ADD R1, R3
CALL vm_push
CALL vm_advance
RET

vm_op_sub:
CALL vm_pop
MOV R3, R1
CALL vm_pop
SUB R1, R3
CALL vm_push
CALL vm_advance
RET

vm_op_mul:
CALL vm_pop
MOV R3, R1
CALL vm_pop
MUL R1, R3
CALL vm_push
CALL vm_advance
RET

vm_op_div:
CALL vm_pop
CMP R1, 0
JEQ vm_div_zero
MOV R3, R1
CALL vm_pop
DIV R1, R3
CALL vm_push
CALL vm_advance
RET
vm_div_zero:
MOV R1, 0
CALL vm_push
CALL vm_advance
RET

vm_op_eq:
CALL vm_pop
MOV R3, R1
CALL vm_pop
CMP R1, R3
JEQ vm_eq_true
MOV R1, 0
JMP vm_eq_push
vm_eq_true:
MOV R1, 1
vm_eq_push:
CALL vm_push
CALL vm_advance
RET

vm_op_lt:
CALL vm_pop
MOV R3, R1
CALL vm_pop
CMP R1, R3
JLT vm_lt_true
MOV R1, 0
JMP vm_lt_push
vm_lt_true:
MOV R1, 1
vm_lt_push:
CALL vm_push
CALL vm_advance
RET

;; Stack manipulation

vm_op_dup:
CALL vm_pop
CALL vm_push
CALL vm_push
CALL vm_advance
RET

vm_op_drop:
CALL vm_pop
CALL vm_advance
RET

vm_op_swap:
CALL vm_pop
MOV R3, R1
CALL vm_pop
MOV R4, R1
MOV R1, R3
CALL vm_push
MOV R1, R4
CALL vm_push
CALL vm_advance
RET

;; Memory — works on the WHOLE 1024-cell RAM, so user programs can
;; read/write any address. With @ and ! plus jumps, MPL is Turing-
;; complete within RAM bounds.

vm_op_load:
CALL vm_pop
LOAD R1, R1
CALL vm_push
CALL vm_advance
RET

vm_op_store:
CALL vm_pop
MOV R3, R1
CALL vm_pop
STORE R1, R3
CALL vm_advance
RET

;; I/O

vm_op_pd:
CALL vm_pop
CALL printd
PUSH R1
MOV R1, 32
OUTC R1
POP R1
CALL vm_advance
RET

vm_op_pc:
CALL vm_pop
OUTC R1
CALL vm_advance
RET

vm_op_nl:
CALL newline
CALL vm_advance
RET

vm_op_halt:
CALL vm_halt
RET

vm_op_rand:
CALL rand
CALL vm_push
CALL vm_advance
RET

vm_op_in:
IN R1
CALL vm_push
CALL vm_advance
RET

;; vm_op_pstack — print the stack as "[a b c]" without consuming it.
;; Scans memory from 0x180 (base) up to SP (exclusive). Useful for
;; debugging MPL programs from inside MPL.
vm_op_pstack:
PUSH R1
MOV R1, 91 ; '['
OUTC R1
POP R1
PUSH R3
PUSH R4
MOV R3, 0x180 ; cursor at base
LOAD R4, 0x384 ; SP (one past top)
vs_lp:
CMP R3, R4
JGE vs_done
LOAD R1, R3
PUSH R3
PUSH R4
CALL printd
POP R4
POP R3
INC R3
CMP R3, R4
JGE vs_done
PUSH R1
MOV R1, 32
OUTC R1
POP R1
JMP vs_lp
vs_done:
PUSH R1
MOV R1, 93 ; ']'
OUTC R1
POP R1
POP R4
POP R3
CALL vm_advance
RET

;; Two-cell instructions

vm_op_pushlit:
CALL vm_fetch_arg
CALL vm_push
CALL vm_advance2
RET

vm_op_jmp:
CALL vm_fetch_arg
CALL vm_jump
RET

vm_op_jz:
CALL vm_pop
CMP R1, 0
JEQ vm_jz_taken
CALL vm_advance2
RET
vm_jz_taken:
CALL vm_fetch_arg
CALL vm_jump
RET

vm_op_jnz:
CALL vm_pop
CMP R1, 0
JNE vm_jnz_taken
CALL vm_advance2
RET
vm_jnz_taken:
CALL vm_fetch_arg
CALL vm_jump
RET


;; ============================================================
;; HELP TEXT
;; ============================================================
;; Six lines summarising the command vocabulary.

print_help:
; " arithmetic + - * / %"
STORE 0, 32
STORE 1, 32
STORE 2, 97
STORE 3, 114
STORE 4, 105
STORE 5, 116
STORE 6, 104
STORE 7, 109
STORE 8, 101
STORE 9, 116
STORE 10, 105
STORE 11, 99
STORE 12, 32
STORE 13, 32
STORE 14, 43
STORE 15, 32
STORE 16, 45
STORE 17, 32
STORE 18, 42
STORE 19, 32
STORE 20, 47
STORE 21, 32
STORE 22, 37
STORE 23, 0
MOV R1, 0
CALL puts
CALL newline
; " bitwise & | ^ ~ < >"
STORE 0, 32
STORE 1, 32
STORE 2, 98
STORE 3, 105
STORE 4, 116
STORE 5, 119
STORE 6, 105
STORE 7, 115
STORE 8, 101
STORE 9, 32
STORE 10, 32
STORE 11, 32
STORE 12, 32
STORE 13, 32
STORE 14, 38
STORE 15, 32
STORE 16, 124
STORE 17, 32
STORE 18, 94
STORE 19, 32
STORE 20, 126
STORE 21, 32
STORE 22, 60
STORE 23, 32
STORE 24, 62
STORE 25, 0
MOV R1, 0
CALL puts
CALL newline
; " math ! f g"
STORE 0, 32
STORE 1, 32
STORE 2, 109
STORE 3, 97
STORE 4, 116
STORE 5, 104
STORE 6, 32
STORE 7, 32
STORE 8, 32
STORE 9, 32
STORE 10, 32
STORE 11, 32
STORE 12, 32
STORE 13, 32
STORE 14, 33
STORE 15, 32
STORE 16, 102
STORE 17, 32
STORE 18, 103
STORE 19, 0
MOV R1, 0
CALL puts
CALL newline
; " io b r o s"
STORE 0, 32
STORE 1, 32
STORE 2, 105
STORE 3, 111
STORE 4, 32
STORE 5, 32
STORE 6, 32
STORE 7, 32
STORE 8, 32
STORE 9, 32
STORE 10, 32
STORE 11, 32
STORE 12, 32
STORE 13, 32
STORE 14, 98
STORE 15, 32
STORE 16, 114
STORE 17, 32
STORE 18, 111
STORE 19, 32
STORE 20, 115
STORE 21, 0
MOV R1, 0
CALL puts
CALL newline
; " vars = @"
STORE 0, 32
STORE 1, 32
STORE 2, 118
STORE 3, 97
STORE 4, 114
STORE 5, 115
STORE 6, 32
STORE 7, 32
STORE 8, 32
STORE 9, 32
STORE 10, 32
STORE 11, 32
STORE 12, 32
STORE 13, 32
STORE 14, 61
STORE 15, 32
STORE 16, 64
STORE 17, 0
MOV R1, 0
CALL puts
CALL newline
; " meta ? q"
STORE 0, 32
STORE 1, 32
STORE 2, 109
STORE 3, 101
STORE 4, 116
STORE 5, 97
STORE 6, 32
STORE 7, 32
STORE 8, 32
STORE 9, 32
STORE 10, 32
STORE 11, 32
STORE 12, 32
STORE 13, 32
STORE 14, 63
STORE 15, 32
STORE 16, 113
STORE 17, 0
MOV R1, 0
CALL puts
CALL newline
; " mpl p x c l"
STORE 0, 32
STORE 1, 32
STORE 2, 109
STORE 3, 112
STORE 4, 108
STORE 5, 32
STORE 6, 32
STORE 7, 32
STORE 8, 32
STORE 9, 32
STORE 10, 32
STORE 11, 32
STORE 12, 32
STORE 13, 32
STORE 14, 112
STORE 15, 32
STORE 16, 120
STORE 17, 32
STORE 18, 99
STORE 19, 32
STORE 20, 108
STORE 21, 0
MOV R1, 0
CALL puts
CALL newline
RET`,
};
