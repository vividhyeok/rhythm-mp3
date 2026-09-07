// Type declarations for fft.js (no bundled types).
declare module 'fft.js' {
  export default class FFT {
    constructor(size: number);
    readonly size: number;
    createComplexArray(): number[];
    realTransform(out: number[], input: ArrayLike<number>): void;
    completeSpectrum(spectrum: number[]): void;
    transform(out: number[], input: number[]): void;
    inverseTransform(out: number[], input: number[]): void;
  }
}
