declare module "pdf-parse" {
  const pdfParse: (data: Buffer | string) => Promise<{
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    text: string;
  }>;
  export default pdfParse;
}
