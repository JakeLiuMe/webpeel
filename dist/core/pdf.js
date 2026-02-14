/**
 * PDF extraction using pdf-parse
 */
export async function extractPdf(buffer) {
    try {
        const pdfParse = (await import('pdf-parse')).default;
        const data = await pdfParse(buffer);
        return {
            text: data.text,
            metadata: {
                title: data.info?.Title || '',
                author: data.info?.Author || '',
                creator: data.info?.Creator || '',
                producer: data.info?.Producer || '',
                creationDate: data.info?.CreationDate || '',
            },
            pages: data.numpages,
        };
    }
    catch (error) {
        throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}. Install pdf-parse: npm install pdf-parse`);
    }
}
//# sourceMappingURL=pdf.js.map