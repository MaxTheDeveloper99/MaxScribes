import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { Book, Page } from '../types';
import { useDropzone } from 'react-dropzone';
import { extractTextFromImage, parsePageNumber } from '../services/gemini';
import { Upload, FileText, Loader2, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';

import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';

interface BookDetailProps {
  book: Book;
}

export default function BookDetail({ book }: BookDetailProps) {
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');

  const { data: pages, isLoading } = useQuery<Page[]>({
    queryKey: ['pages', book.id],
    queryFn: async () => {
      const res = await api.get(`/books/${book.id}/pages`);
      return res.data;
    },
  });

  const uploadPageMutation = useMutation({
    mutationFn: async ({ file, content, pageNumber }: { file: File; content: string; pageNumber: number }) => {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('content', content);
      formData.append('page_number', pageNumber.toString());
      const res = await api.post(`/books/${book.id}/pages`, formData);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages', book.id] });
    },
  });

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    console.log('Files dropped:', acceptedFiles);
    setIsUploading(true);
    
    // Calculate the starting page number based on existing pages
    let nextPageNumber = (pages?.length ? Math.max(...pages.map(p => p.page_number)) + 1 : 1);

    for (const file of acceptedFiles) {
      try {
        setUploadStatus(`Processing ${file.name}...`);
        console.log(`Processing ${file.name}, size: ${file.size} bytes`);
        
        // Convert to base64 for Gemini
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            if (!result) return reject(new Error("File is empty or could not be read."));
            const base64 = result.split(',')[1];
            if (!base64) return reject(new Error("Invalid image data format."));
            resolve(base64);
          };
          reader.onerror = () => {
            const errorMsg = reader.error?.message || "Unknown disk error";
            reject(new Error(`Browser could not read file: ${errorMsg}. Try closing other apps or downloading the file to your device first.`));
          };
          reader.onabort = () => reject(new Error("File read was aborted."));
        });
        
        if (file.size === 0) throw new Error("The selected file is empty (0 bytes).");
        
        reader.readAsDataURL(file);
        const base64 = await base64Promise;
        console.log('Base64 conversion complete');

        // Extract text using Gemini
        console.log('Calling Gemini API...');
        const text = await extractTextFromImage(base64, file.type);
        console.log('Gemini response received');
        
        if (!text || text === "No text extracted.") {
          throw new Error("Gemini failed to extract text. Please check your API key.");
        }

        // Try to find page number in text, otherwise use our sequential counter
        const detectedPageNumberFromText = parsePageNumber(text);
        const finalPageNumber = detectedPageNumberFromText !== null ? detectedPageNumberFromText : nextPageNumber;
        
        // Update our counter for the next file in this batch
        nextPageNumber = Math.max(nextPageNumber, finalPageNumber + 1);

        // Upload to backend
        await uploadPageMutation.mutateAsync({
          file,
          content: text,
          pageNumber: finalPageNumber,
        });

        setUploadStatus(`Successfully processed ${file.name}`);
        
        // Add a small delay between files to avoid hitting rate limits (1 second)
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        console.error('Error processing file:', error);
        let errorMessage = error.response?.data?.error || error.message;
        
        if (errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED")) {
          errorMessage = "The AI is currently busy (Rate Limit). Please wait a minute and try uploading the remaining images in smaller batches.";
        }
        
        alert(`Error processing ${file.name}: ${errorMessage}`);
        setUploadStatus(`Error: ${errorMessage}`);
      }
    }
    setIsUploading(false);
    setUploadStatus('');
  }, [book.id, pages, uploadPageMutation]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
  });

  const downloadFullText = async () => {
    if (!pages) return;

    const sortedPages = [...pages].sort((a, b) => a.page_number - b.page_number);

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: sortedPages.flatMap(p => {
            // Clean content: remove markdown bold (**) and blockquote (>)
            const cleanContent = p.content
              .replace(/\*\*(.*?)\*\*/g, '$1') // Remove **bold**
              .replace(/^>\s*/gm, ''); // Remove > at start of lines

            return [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `--- PAGE ${p.page_number} ---`,
                    bold: true,
                    size: 24,
                    font: "Times New Roman"
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: "",
                  }),
                ],
              }),
              ...cleanContent.split('\n').map(line => 
                new Paragraph({
                  children: [
                    new TextRun({
                      text: line,
                      size: 22,
                      font: "Times New Roman"
                    }),
                  ],
                })
              ),
              new Paragraph({
                children: [
                  new TextRun({
                    text: "",
                  }),
                ],
              }),
            ];
          }),
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${book.title}_transcription.docx`);
  };

  return (
    <div className="space-y-8 sm:space-y-12">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-[#5A5A40]/10 text-[#5A5A40] text-[9px] sm:text-[10px] lg:text-xs font-sans font-bold uppercase tracking-widest rounded-full">
              Project
            </span>
            <span className="text-[#5A5A40]/40 text-[10px] sm:text-xs lg:text-sm font-sans">ID: {book.id}</span>
          </div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-[#1A1A1A] tracking-tight truncate">{book.title}</h2>
          <p className="text-base sm:text-lg lg:text-xl text-[#5A5A40] italic mt-1 sm:mt-2 truncate">{book.author}</p>
        </div>
        
        <button
          onClick={downloadFullText}
          disabled={!pages || pages.length === 0}
          className="w-full lg:w-auto flex items-center justify-center gap-2 bg-white border border-[#5A5A40]/20 text-[#5A5A40] px-5 sm:px-6 py-2.5 sm:py-3 rounded-full hover:bg-[#F5F5F0] transition-all font-sans font-semibold disabled:opacity-50 shadow-sm text-sm sm:text-base whitespace-nowrap"
        >
          <Download size={18} />
          Download .docx
        </button>
      </div>

      {/* Upload Area */}
      <div 
        {...getRootProps()} 
        className={`
          relative overflow-hidden border-2 border-dashed rounded-3xl p-6 sm:p-12 text-center transition-all cursor-pointer
          ${isDragActive ? 'border-[#5A5A40] bg-[#5A5A40]/5 scale-[1.01]' : 'border-[#5A5A40]/20 bg-white hover:border-[#5A5A40]/40'}
          ${isUploading ? 'pointer-events-none opacity-80' : ''}
        `}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-4">
          <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center transition-colors ${isDragActive ? 'bg-[#5A5A40] text-white' : 'bg-[#F5F5F0] text-[#5A5A40]'}`}>
            {isUploading ? <Loader2 className="animate-spin" size={24} /> : <Upload size={24} />}
          </div>
          <div>
            <p className="text-lg sm:text-xl font-bold text-[#1A1A1A]">
              {isUploading ? 'Processing Pages...' : 'Drop book page images here'}
            </p>
            <p className="text-sm sm:text-base text-[#5A5A40]/60 font-sans mt-1">
              {isUploading ? uploadStatus : 'or click to browse files (JPG, PNG)'}
            </p>
          </div>
        </div>
        
        {isUploading && (
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: '100%' }}
            className="absolute bottom-0 left-0 h-1 bg-[#5A5A40]"
          />
        )}
      </div>

      {/* Pages List */}
      <div className="space-y-6 sm:space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#5A5A40]/10 pb-4 gap-4">
          <h3 className="text-lg sm:text-xl lg:text-2xl font-bold flex flex-wrap items-center gap-2 sm:gap-3">
            <FileText size={20} className="text-[#5A5A40] sm:size-6" />
            <span className="flex-1 min-w-0">Transcribed Pages</span>
            <span className="text-[10px] sm:text-xs font-sans font-normal text-[#5A5A40]/60 bg-[#F5F5F0] px-2 sm:px-3 py-0.5 sm:py-1 rounded-full whitespace-nowrap">
              {pages?.length || 0} pages
            </span>
          </h3>
          <div className="text-[9px] sm:text-[10px] lg:text-xs font-sans font-bold text-[#5A5A40]/40 uppercase tracking-widest">
            <span>Ordered Numerically</span>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-20">
            <Loader2 className="animate-spin mx-auto text-[#5A5A40] mb-4" size={32} />
            <p className="text-[#5A5A40]/60 italic">Loading pages...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-12">
            <AnimatePresence initial={false}>
              {pages?.sort((a, b) => a.page_number - b.page_number).map((page, index) => (
                <motion.div
                  key={page.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="grid grid-cols-1 lg:grid-cols-2 gap-8 group"
                >
                  {/* Image Preview */}
                  <div className="relative aspect-[3/4] bg-white rounded-2xl overflow-hidden shadow-md border border-[#5A5A40]/10">
                    <img 
                      src={page.image_data} 
                      alt={`Page ${page.page_number}`} 
                      className="w-full h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute top-4 left-4 bg-[#1A1A1A]/80 backdrop-blur-md text-white px-4 py-2 rounded-full text-sm font-sans font-bold">
                      Page {page.page_number}
                    </div>
                  </div>

                  {/* Text Content */}
                  <div className="flex flex-col">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 sm:mb-4 gap-2">
                      <div className="flex items-center gap-2 text-[#5A5A40]">
                        <CheckCircle2 size={14} className="text-emerald-600 sm:size-4" />
                        <span className="text-[9px] sm:text-[10px] lg:text-xs font-sans font-bold uppercase tracking-widest">Transcription Verified</span>
                      </div>
                      <span className="text-[9px] sm:text-[10px] lg:text-xs font-sans text-[#5A5A40]/40 italic">
                        Processed {new Date(page.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    
                    <div className="flex-1 bg-white p-5 sm:p-6 lg:p-8 rounded-2xl shadow-sm border border-[#5A5A40]/10 prose prose-stone max-w-none overflow-auto max-h-[350px] sm:max-h-[400px] lg:max-h-[500px] font-serif leading-relaxed text-[#1A1A1A] text-sm sm:text-base">
                      <Markdown>{page.content}</Markdown>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {pages?.length === 0 && (
              <div className="text-center py-20 bg-white/30 rounded-3xl border-2 border-dashed border-[#5A5A40]/10">
                <AlertCircle size={48} className="mx-auto text-[#5A5A40]/20 mb-4" />
                <p className="text-[#5A5A40]/60 italic">No pages transcribed yet. Upload images to begin.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
