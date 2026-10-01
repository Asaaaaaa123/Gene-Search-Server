declare module 'plotly.js/dist/plotly' {
  const Plotly: {
    downloadImage: (gd: HTMLElement, opts: Record<string, unknown>) => Promise<unknown>;
    relayout: (gd: HTMLElement, update: Record<string, unknown>) => Promise<unknown>;
    update: (
      gd: HTMLElement,
      traceUpdate: Record<string, unknown>,
      layoutUpdate: Record<string, unknown>,
      traces?: number[],
    ) => Promise<unknown>;
  };
  export default Plotly;
}
