import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { Book, Page } from '../types';
import { useDropzone } from 'react-dropzone';
import { extractTextFromImage, parsePageNumber, sleep } from '../services/gemini';
import { optimizeImageForOcr } from '../utils/imageOptimizer';
import { Upload, FileText, Loader2, Download, CheckCircle2, AlertCircle, RefreshCw, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';

import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';

interface BookDetailProps {
  book: Book;
}

interface FailedFileItem {
  file: File;
  error: string;
}

export default function BookDetail({ book }: BookDetailProps) {
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [failedFiles, setFailedFiles] = useState<FailedFileItem[]>([]);
  const [notification, setNotification] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

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

  const processFiles = useCallback(async (filesToProcess: File[]) => {
    if (!filesToProcess || filesToProcess.length === 0) return;

    setIsUploading(true);
    setNotification(null);
    const currentFailed: FailedFileItem[] = [];
    let successCount = 0;

    // Calculate the starting page number based on existing pages
    let nextPageNumber = pages?.length ? Math.max(...pages.map(p => p.page_number)) + 1 : 1;

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      setUploadProgress({
        current: i + 1,
        total: filesToProcess.length,
        fileName: file.name,
      });

      try {
        setUploadStatus(`Optimizing image: ${file.name}...`);
        
        // 1. Optimize image (resizes down to 1600px & converts to crisp 85% JPEG to prevent rate & token exhaustion)
        const { base64Data, mimeType, optimizedFile } = await optimizeImageForOcr(file, 1600);

        setUploadStatus(`Transcribing ${file.name} with AI...`);

        // 2. Extract text using AI with automatic rate-limit countdown and fallback
        const text = await extractTextFromImage(base64Data, mimeType, (statusUpdate) => {
          setUploadStatus(statusUpdate);
        });

        if (!text || text.trim() === "No text extracted.") {
          throw new Error("AI could not extract text from this page. Please ensure the image is clear.");
        }

        // 3. Try to find page number in text, otherwise use our sequential counter
        const detectedPageNumberFromText = parsePageNumber(text);
        const finalPageNumber = detectedPageNumberFromText !== null ? detectedPageNumberFromText : nextPageNumber;
        nextPageNumber = Math.max(nextPageNumber, finalPageNumber + 1);

        setUploadStatus(`Saving page ${finalPageNumber}...`);

        // 4. Upload to backend
        await uploadPageMutation.mutateAsync({
          file: optimizedFile,
          content: text,
          pageNumber: finalPageNumber,
        });

        successCount++;
        setUploadStatus(`Saved page ${finalPageNumber} (${file.name})`);

        // Pacing: add a polite 2.5s delay between images to stay well within free-tier quota limits
        if (i < filesToProcess.length - 1) {
          setUploadStatus(`Page ${finalPageNumber} saved. Pacing next page in 2s...`);
          await sleep(2000);
        }
      } catch (error: any) {
        console.error(`Error processing file ${file.name}:`, error);
        let errorMsg = error.response?.data?.error || error.message || "Unknown processing error";
        
        if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
          errorMsg = "AI rate limit reached. The system paused, but quota remained exhausted.";
        }

        currentFailed.push({
          file,
          error: errorMsg,
        });

        // Briefly wait so subsequent images don't fail simultaneously
        if (i < filesToProcess.length - 1) {
          setUploadStatus(`Encountered issue with ${file.name}. Pausing before next page...`);
          await sleep(4000);
        }
      }
    }

    setIsUploading(false);
    setUploadProgress(null);
    setUploadStatus('');
    setFailedFiles(currentFailed);

    if (currentFailed.length === 0) {
      setNotification({
        type: 'success',
        message: `Successfully transcribed and added all ${successCount} pages!`,
      });
    } else if (successCount > 0) {
      setNotification({
        type: 'warning',
        message: `Processed ${successCount} of ${filesToProcess.length} pages. ${currentFailed.length} page(s) could not be completed.`,
      });
    } else {
      setNotification({
        type: 'error',
        message: `Could not transcribe the pages. Please check your network connection and API key.`,
      });
    }
  }, [book.id, pages, uploadPageMutation]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    processFiles(acceptedFiles);
  }, [processFiles]);

  const retryFailedFiles = () => {
    const filesToRetry = failedFiles.map(f => f.file);
    setFailedFiles([]);
    processFiles(filesToRetry);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    disabled: isUploading,
  });

  const downloadFullText = async () => {
    if (!pages) return;

    const sortedPages = [...pages].sort((a, b) => a.page_number - b.page_number);

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: sortedPages.flatMap(p => {
            const cleanContent = (p.content || "")
              .replace(/\*\*(.*?)\*\*/g, '$1')
              .replace(/^>\s*/gm, '');

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
              ...cleanContent.split('\n\n').map(
                para =>
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: para.trim(),
                        font: "Times New Roman",
                        size: 24,
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
      {/* Header Info */}
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

      {/* Notification Banner */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`p-4 rounded-2xl flex items-center justify-between gap-4 ${
              notification.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                : notification.type === 'warning'
                ? 'bg-amber-50 text-amber-900 border border-amber-200'
                : 'bg-rose-50 text-rose-900 border border-rose-200'
            }`}
          >
            <div className="flex items-center gap-3">
              {notification.type === 'success' ? (
                <CheckCircle2 className="text-emerald-600 shrink-0" size={20} />
              ) : (
                <AlertCircle className={notification.type === 'warning' ? "text-amber-600 shrink-0" : "text-rose-600 shrink-0"} size={20} />
              )}
              <span className="text-sm font-sans font-medium">{notification.message}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-stone-400 hover:text-stone-700 transition-colors p-1"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Failed Items Banner with Retry Option */}
      {failedFiles.length > 0 && !isUploading && (
        <div className="p-5 rounded-2xl bg-amber-50/80 border border-amber-200/80 text-amber-950 font-sans space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle size={18} className="text-amber-600" />
              <span className="font-semibold text-sm">
                {failedFiles.length} page{failedFiles.length > 1 ? 's' : ''} encountered an issue during transcription
              </span>
            </div>
            <button
              onClick={retryFailedFiles}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm"
            >
              <RefreshCw size={14} />
              Retry {failedFiles.length} Failed Page{failedFiles.length > 1 ? 's' : ''}
            </button>
          </div>
          <div className="text-xs text-amber-900/80 space-y-1">
            {failedFiles.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="font-mono font-medium">• {item.file.name}:</span>
                <span className="italic">{item.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Dropzone & Progress Area */}
      <div 
        {...getRootProps()} 
        className={`
          relative overflow-hidden border-2 border-dashed rounded-3xl p-6 sm:p-10 text-center transition-all
          ${isDragActive ? 'border-[#5A5A40] bg-[#5A5A40]/5 scale-[1.01]' : 'border-[#5A5A40]/20 bg-white hover:border-[#5A5A40]/40'}
          ${isUploading ? 'cursor-default pointer-events-none' : 'cursor-pointer'}
        `}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-4">
          <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center transition-colors ${isDragActive ? 'bg-[#5A5A40] text-white' : 'bg-[#F5F5F0] text-[#5A5A40]'}`}>
            {isUploading ? <Loader2 className="animate-spin" size={24} /> : <Upload size={24} />}
          </div>
          
          <div className="max-w-md mx-auto">
            <p className="text-lg sm:text-xl font-bold text-[#1A1A1A]">
              {isUploading ? 'Transcribing Pages...' : 'Drop book page images here'}
            </p>
            
            {isUploading && uploadProgress ? (
              <div className="mt-2 space-y-2">
                <p className="text-xs sm:text-sm font-sans font-semibold text-[#5A5A40]">
                  Page {uploadProgress.current} of {uploadProgress.total} &bull; {uploadProgress.fileName}
                </p>
                <p className="text-xs text-[#5A5A40]/80 font-sans italic">
                  {uploadStatus || 'Processing with Gemini AI...'}
                </p>
                {/* Progress bar */}
                <div className="w-full bg-[#5A5A40]/10 rounded-full h-2 overflow-hidden mt-3">
                  <motion.div
                    className="bg-[#5A5A40] h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm sm:text-base text-[#5A5A40]/60 font-sans mt-1">
                Drag &amp; drop multiple images or click to select (auto-optimized &amp; ordered)
              </p>
            )}
          </div>
        </div>
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
                  transition={{ delay: index * 0.05 }}
                  className="grid grid-cols-1 lg:grid-cols-2 gap-8 group"
                >
                  {/* Image Preview */}
                  <div className="relative aspect-[3/4] bg-white rounded-2xl overflow-hidden shadow-md border border-[#5A5A40]/10">
                    <img 
                      src={page.image_data || undefined} 
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
