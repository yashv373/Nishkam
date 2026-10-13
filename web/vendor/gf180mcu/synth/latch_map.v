// Latch mapping for gf180mcu_fd_sc_mcu7t5v0 (Yosys techmap), used by the Nishkam Studio synthesis step.
// The gf180mcuD PDK ships no SYNTH_LATCH_MAP (LibreLane leaves latches unmapped there), so this follows the
// sky130 latch_map.v pattern of the same LibreLane flow. Cell pins come from the PDK liberty. Apache-2.0.

module \$_DLATCH_P_ (input E, input D, output Q);
  gf180mcu_fd_sc_mcu7t5v0__latq_1 _TECHMAP_REPLACE_ (.E(E), .D(D), .Q(Q));
endmodule

module \$_DLATCH_N_ (input E, input D, output Q);
  gf180mcu_fd_sc_mcu7t5v0__latq_1 _TECHMAP_REPLACE_ (.E(~E), .D(D), .Q(Q));
endmodule

module \$_DLATCH_PP0_ (input E, input R, input D, output Q);
  gf180mcu_fd_sc_mcu7t5v0__latrnq_1 _TECHMAP_REPLACE_ (.E(E), .RN(~R), .D(D), .Q(Q));
endmodule

module \$_DLATCH_PP1_ (input E, input R, input D, output Q);
  gf180mcu_fd_sc_mcu7t5v0__latsnq_1 _TECHMAP_REPLACE_ (.E(E), .SETN(~R), .D(D), .Q(Q));
endmodule

module \$_DLATCH_PN0_ (input E, input R, input D, output Q);
  gf180mcu_fd_sc_mcu7t5v0__latrnq_1 _TECHMAP_REPLACE_ (.E(E), .RN(R), .D(D), .Q(Q));
endmodule

module \$_DLATCH_PN1_ (input E, input R, input D, output Q);
  gf180mcu_fd_sc_mcu7t5v0__latsnq_1 _TECHMAP_REPLACE_ (.E(E), .SETN(R), .D(D), .Q(Q));
endmodule

module \$_DLATCH_NP0_ (input E, input R, input D, output Q);
  gf180mcu_fd_sc_mcu7t5v0__latrnq_1 _TECHMAP_REPLACE_ (.E(~E), .RN(~R), .D(D), .Q(Q));
endmodule

module \$_DLATCH_NP1_ (input E, input R, input D, output Q);
  gf180mcu_fd_sc_mcu7t5v0__latsnq_1 _TECHMAP_REPLACE_ (.E(~E), .SETN(~R), .D(D), .Q(Q));
endmodule

module \$_DLATCH_NN0_ (input E, input R, input D, output Q);
  gf180mcu_fd_sc_mcu7t5v0__latrnq_1 _TECHMAP_REPLACE_ (.E(~E), .RN(R), .D(D), .Q(Q));
endmodule

module \$_DLATCH_NN1_ (input E, input R, input D, output Q);
  gf180mcu_fd_sc_mcu7t5v0__latsnq_1 _TECHMAP_REPLACE_ (.E(~E), .SETN(R), .D(D), .Q(Q));
endmodule
