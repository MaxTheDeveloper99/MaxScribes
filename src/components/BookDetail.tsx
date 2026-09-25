import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { Book, Page } from '../types';
import { useDropzone } from 'react-dropzone';
import { extractTextFromImage, parsePageNumber, sleep } from '../services/gemini';
import { optimizeImageForOcr } from '../utils/imageOptimizer';
import { 
  Upload, 
  FileText, 
  Download, 
  Check, 
  Copy, 
  RefreshCw, 
  X, 
  Eye, 
  Edit3, 
  Trash2, 
  Columns, 
  BookOpen, 
  Maximize2 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import { cleanTranscribedText } from '../utils/textCleaner';

interface BookDetailProps {
  book: Book;
  onBack?: () => void;
  onUpdateBook?: (book: Book) => void;
}

interface FailedFileItem {
  file: File;
  error: string;
}

export default function BookDetail({ book, onBack, onUpdateBook }: BookDetailProps) {
  const queryClient = useQueryClient();
  const [currentStatus, setCurrentStatus] = useState<string>(book.status || 'active');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [failedFiles, setFailedFiles] = useState<FailedFileItem[]>([]);
  const [notification, setNotification] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  const updateBookStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      await api.patch(`/books/${book.id}`, { status: newStatus });
      return newStatus;
    },
    onSuccess: (newStatus) => {
      setCurrentStatus(newStatus);
      queryClient.invalidateQueries({ queryKey: ['books'] });
      onUpdateBook?.({ ...book, status: newStatus });
      setNotification({
        type: 'success',
        message: `Project status set to "${newStatus.replace('-', ' ')}".`,
      });
    },
    onError: (err: any) => {
      alert(`Failed to update project status: ${err.response?.data?.error || err.message}`);
    }
  });
  
  const [viewMode, setViewMode] = useState<'split' | 'continuous'>('split');
  const [inspectImage, setInspectImage] = useState<{ url: string; pageNum: number } | null>(null);
  const [copiedPageId, setCopiedPageId] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [editingPageId, setEditingPageId] = useState<number | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');

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

  const updatePageMutation = useMutation({
    mutationFn: async ({ id, content }: { id: number; content: string }) => {
      await api.patch(`/api/pages/${id}`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages', book.id] });
      setEditingPageId(null);
    },
    onError: (err: any) => {
      alert(`Could not save page edits: ${err.message}`);
    }
  });

  const deletePageMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/pages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages', book.id] });
    },
    onError: (err: any) => {
      alert(`Could not delete page: ${err.message}`);
    }
  });

  const stats = useMemo(() => {
    if (!pages || pages.length === 0) return { totalPages: 0, totalWords: 0 };
    const totalWords = pages.reduce((acc, p) => {
      const words = (p.content || '').trim().split(/\s+/).filter(Boolean).length;
      return acc + words;
    }, 0);
    return {
      totalPages: pages.length,
      totalWords,
    };
  }, [pages]);

  const processFiles = useCallback(async (filesToProcess: File[]) => {
    if (!filesToProcess || filesToProcess.length === 0) return;

    setIsUploading(true);
    setNotification(null);
    const currentFailed: FailedFileItem[] = [];
    let successCount = 0;

    let nextPageNumber = pages?.length ? Math.max(...pages.map(p => p.page_number)) + 1 : 1;

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      setUploadProgress({
        current: i + 1,
        total: filesToProcess.length,
        fileName: file.name,
      });

      try {
        setUploadStatus(`Preparing ${file.name}...`);
        const { base64Data, mimeType, optimizedFile } = await optimizeImageForOcr(file, 1600);

        setUploadStatus(`Transcribing ${file.name}...`);
        const text = await extractTextFromImage(base64Data, mimeType, (statusUpdate) => {
          setUploadStatus(statusUpdate);
        });

        const rawText = text && text.trim() ? text.trim() : "[No legible text detected on this page]";
        const finalText = cleanTranscribedText(rawText);
        const detectedPageNumberFromText = parsePageNumber(finalText);
        const finalPageNumber = detectedPageNumberFromText !== null ? detectedPageNumberFromText : nextPageNumber;
        nextPageNumber = Math.max(nextPageNumber, finalPageNumber + 1);

        setUploadStatus(`Saving Page ${finalPageNumber}...`);
        await uploadPageMutation.mutateAsync({
          file: optimizedFile,
          content: finalText,
          pageNumber: finalPageNumber,
        });

        successCount++;
        setUploadStatus(`Saved Page ${finalPageNumber}`);

        if (i < filesToProcess.length - 1) {
          await sleep(2500);
        }
      } catch (error: any) {
        console.error(`Error processing file ${file.name}:`, error);
        let errorMsg = error.response?.data?.error || error.message || "Processing error";
        
        const isTransient =
          errorMsg.includes("429") ||
          errorMsg.includes("503") ||
          errorMsg.includes("RESOURCE_EXHAUSTED") ||
          errorMsg.includes("high demand") ||
          errorMsg.includes("UNAVAILABLE");

        if (isTransient) {
          errorMsg = "Service busy. Pausing before next retry...";
          if (i < filesToProcess.length - 1) {
            setUploadStatus(`Service limit reached on ${file.name}. Waiting 15s...`);
            await sleep(15000);
          }
        } else if (i < filesToProcess.length - 1) {
          await sleep(4000);
        }

        currentFailed.push({ file, error: errorMsg });
      }
    }

    setIsUploading(false);
    setUploadProgress(null);
    setUploadStatus('');
    setFailedFiles(currentFailed);

    if (currentFailed.length === 0) {
      setNotification({
        type: 'success',
        message: `Successfully transcribed ${successCount} page${successCount > 1 ? 's' : ''}.`,
      });
    } else if (successCount > 0) {
      setNotification({
        type: 'warning',
        message: `Added ${successCount} of ${filesToProcess.length} pages. ${currentFailed.length} could not be completed.`,
      });
    } else {
      setNotification({
        type: 'error',
        message: `Could not transcribe the uploaded pages. Please check your connection.`,
      });
    }
  }, [book.id, pages, uploadPageMutation]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const sorted = [...acceptedFiles].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    processFiles(sorted);
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
    if (!pages || pages.length === 0) return;

    const sortedPages = [...pages].sort((a, b) => a.page_number - b.page_number);

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: sortedPages.flatMap(p => {
            const cleanContent = cleanTranscribedText(p.content || "")
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
                children: [new TextRun({ text: "" })],
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
                children: [new TextRun({ text: "" })],
              }),
            ];
          }),
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${book.title.replace(/\s+/g, '_')}_transcription.docx`);
  };

  const copyFullManuscript = () => {
    if (!pages || pages.length === 0) return;
    const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);
    const fullText = sorted
      .map(p => `=== Page ${p.page_number} ===\n\n${cleanTranscribedText(p.content || '')}\n`)
      .join('\n\n');
    navigator.clipboard.writeText(fullText);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const copyPageText = (pageId: number, content: string) => {
    navigator.clipboard.writeText(cleanTranscribedText(content));
    setCopiedPageId(pageId);
    setTimeout(() => setCopiedPageId(null), 2000);
  };

  const startEditPage = (page: Page) => {
    setEditingPageId(page.id);
    setEditedContent(page.content || '');
  };

  const saveEditPage = (pageId: number) => {
    updatePageMutation.mutate({ id: pageId, content: editedContent });
  };

  const sortedPages = useMemo(() => {
    if (!pages) return [];
    return [...pages].sort((a, b) => a.page_number - b.page_number);
  }, [pages]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b border-[#E7E2D8] pb-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#8C8275] mb-2.5">
              {/* Interactive Status Selector */}
              <div className="inline-flex items-center gap-1.5 bg-white border border-[#E7E2D8] hover:border-[#1C1917] px-2.5 py-1 rounded-md transition-colors shadow-2xs">
                <span
                  className={`w-2 h-2 rounded-full ${
                    currentStatus === 'completed'
                      ? 'bg-emerald-600'
                      : currentStatus === 'on-hold'
                      ? 'bg-amber-600'
                      : 'bg-stone-500'
                  }`}
                />
                <span className="text-[11px] text-[#8C8275] font-medium">Status:</span>
                <select
                  value={currentStatus}
                  onChange={(e) => updateBookStatusMutation.mutate(e.target.value)}
                  disabled={updateBookStatusMutation.isPending}
                  className="bg-transparent text-xs font-semibold text-[#1C1917] cursor-pointer focus:outline-none capitalize pr-1"
                >
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="on-hold">On Hold</option>
                </select>
              </div>

              <span aria-hidden="true" className="text-[#E7E2D8]">·</span>
              <span>{stats.totalPages} {stats.totalPages === 1 ? 'page' : 'pages'}</span>
              {stats.totalWords > 0 && (
                <>
                  <span aria-hidden="true" className="text-[#E7E2D8]">·</span>
                  <span>{stats.totalWords.toLocaleString()} words</span>
                </>
              )}
            </div>

            <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1C1917] tracking-tight leading-tight">
              {book.title}
            </h1>
            
            {book.author && (
              <p className="mt-1 text-base sm:text-lg text-[#6E6659] italic font-serif">
                {book.author}
              </p>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={copyFullManuscript}
              disabled={sortedPages.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-[#E7E2D8] hover:border-[#1C1917] text-[#1C1917] rounded-md transition-colors disabled:opacity-40 cursor-pointer"
            >
              {copiedAll ? <Check size={14} className="text-emerald-700" /> : <Copy size={14} />}
              <span>{copiedAll ? 'Copied' : 'Copy All Text'}</span>
            </button>

            <button
              onClick={downloadFullText}
              disabled={sortedPages.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#1C1917] hover:bg-[#2D2926] text-[#FAF8F5] rounded-md transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Download size={14} />
              <span>Download .docx</span>
            </button>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="mt-6 pt-4 border-t border-[#F0EBE1] flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-[#F0EBE1] rounded-md">
            <button
              onClick={() => setViewMode('split')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'split' 
                  ? 'bg-white text-[#1C1917] shadow-2xs font-semibold' 
                  : 'text-[#6E6659] hover:text-[#1C1917]'
              }`}
            >
              <Columns size={13} />
              <span>Side-by-Side</span>
            </button>
            <button
              onClick={() => setViewMode('continuous')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'continuous' 
                  ? 'bg-white text-[#1C1917] shadow-2xs font-semibold' 
                  : 'text-[#6E6659] hover:text-[#1C1917]'
              }`}
            >
              <BookOpen size={13} />
              <span>Reading View</span>
            </button>
          </div>

          <div className="text-xs text-[#8C8275]">
            {sortedPages.length} {sortedPages.length === 1 ? 'page' : 'pages'}
          </div>
        </div>
      </div>

      {/* Notifications */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`p-3.5 border rounded-md flex items-center justify-between gap-3 text-xs ${
              notification.type === 'success'
                ? 'bg-white border-emerald-300 text-emerald-900'
                : notification.type === 'warning'
                ? 'bg-white border-amber-300 text-amber-900'
                : 'bg-white border-rose-300 text-rose-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold capitalize">{notification.type}:</span>
              <span>{notification.message}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-[#8C8275] hover:text-[#1C1917] p-1 cursor-pointer"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Retry Failed Files */}
      {failedFiles.length > 0 && !isUploading && (
        <div className="p-4 bg-white border border-amber-300 rounded-md text-xs space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="font-semibold text-amber-900">
              {failedFiles.length} page{failedFiles.length > 1 ? 's' : ''} failed to process.
            </span>
            <button
              onClick={retryFailedFiles}
              className="inline-flex items-center gap-1.5 bg-[#1C1917] text-[#FAF8F5] px-3 py-1.5 rounded text-xs font-medium cursor-pointer hover:bg-[#2D2926]"
            >
              <RefreshCw size={12} />
              <span>Retry {failedFiles.length} Failed</span>
            </button>
          </div>
          <div className="text-[#6E6659] space-y-1 font-mono text-[11px]">
            {failedFiles.map((item, idx) => (
              <div key={idx}>• {item.file.name}: {item.error}</div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Dropzone */}
      <div
        {...getRootProps()}
        className={`
          border border-dashed transition-all p-8 text-center relative
          ${isDragActive ? 'border-[#1C1917] bg-[#F2EDE4]' : 'border-[#D0C8BC] bg-white hover:border-[#1C1917]'}
          ${isUploading ? 'cursor-default pointer-events-none' : 'cursor-pointer'}
        `}
      >
        <input {...getInputProps()} />
        <div className="max-w-md mx-auto space-y-3">
          <div className="w-10 h-10 border border-[#E7E2D8] bg-[#FAF8F5] rounded-md flex items-center justify-center mx-auto text-[#1C1917]">
            {isUploading ? (
              <div className="w-4 h-4 border-2 border-[#1C1917] border-t-transparent rounded-full animate-spin" />
            ) : (
              <Upload size={18} />
            )}
          </div>

          <div>
            <h3 className="font-serif text-lg font-bold text-[#1C1917]">
              {isUploading ? 'Transcribing Pages...' : 'Upload Page Images'}
            </h3>
            
            {isUploading && uploadProgress ? (
              <div className="mt-3 space-y-2 text-xs">
                <p className="font-mono text-[#1C1917] font-semibold">
                  Page {uploadProgress.current} of {uploadProgress.total} &mdash; {uploadProgress.fileName}
                </p>
                <p className="text-[#6E6659] italic">
                  {uploadStatus || 'Processing...'}
                </p>
                <div className="w-full bg-[#E7E2D8] h-1.5 rounded-full overflow-hidden mt-2">
                  <div
                    className="bg-[#1C1917] h-full transition-all duration-300"
                    style={{
                      width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-[#6E6659] mt-1">
                Drag and drop book page photos or scans here, or click to select files.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Pages Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-[#E7E2D8] pb-3">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-[#8C8275]" />
            <h2 className="font-serif text-xl font-bold text-[#1C1917]">Pages</h2>
            <span className="text-xs text-[#8C8275]">({sortedPages.length})</span>
          </div>
        </div>

        {isLoading ? (
          <div className="py-20 text-center">
            <div className="inline-block w-6 h-6 border-2 border-[#1C1917] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-[#6E6659]">Loading pages...</p>
          </div>
        ) : sortedPages.length === 0 ? (
          <div className="text-center py-16 bg-white border border-[#E7E2D8] p-6">
            <p className="text-sm text-[#6E6659]">
              No pages uploaded yet. Upload images above to begin.
            </p>
          </div>
        ) : viewMode === 'split' ? (
          /* Side-by-Side View */
          <div className="space-y-8">
            {sortedPages.map((page) => (
              <article 
                key={page.id}
                className="bg-white border border-[#E7E2D8] p-5 sm:p-7 transition-all"
              >
                {/* Page Header */}
                <div className="flex items-center justify-between pb-3 mb-5 border-b border-[#F0EBE1] text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm text-[#1C1917]">
                      Page {page.page_number}
                    </span>
                    <span aria-hidden="true" className="text-[#CFC7B9]">·</span>
                    <span className="text-[#6E6659]">
                      {page.content ? `${page.content.trim().split(/\s+/).filter(Boolean).length} words` : 'Empty'}
                    </span>
                    <span aria-hidden="true" className="text-[#CFC7B9]">·</span>
                    <span className="text-[#8C8275]">
                      {new Date(page.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyPageText(page.id, page.content || '')}
                      className="p-1.5 text-[#6E6659] hover:text-[#1C1917] transition-colors cursor-pointer"
                      title="Copy page text"
                      aria-label="Copy page text"
                    >
                      {copiedPageId === page.id ? <Check size={14} className="text-emerald-700" /> : <Copy size={14} />}
                    </button>

                    <button
                      onClick={() => startEditPage(page)}
                      className="p-1.5 text-[#6E6659] hover:text-[#1C1917] transition-colors cursor-pointer"
                      title="Edit text"
                      aria-label="Edit text"
                    >
                      <Edit3 size={14} />
                    </button>

                    <button
                      onClick={() => {
                        if (confirm(`Delete Page ${page.page_number}?`)) {
                          deletePageMutation.mutate(page.id);
                        }
                      }}
                      className="p-1.5 text-[#B0A799] hover:text-rose-700 transition-colors cursor-pointer"
                      title="Delete page"
                      aria-label="Delete page"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* 2-Column Split: Scanned Page vs Text */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left: Original Image */}
                  <div className="lg:col-span-5 relative group">
                    <div 
                      className="relative aspect-[3/4] bg-[#FAF8F5] border border-[#E7E2D8] overflow-hidden cursor-zoom-in"
                      onClick={() => page.image_data && setInspectImage({ url: page.image_data, pageNum: page.page_number })}
                    >
                      {page.image_data ? (
                        <img
                          src={page.image_data}
                          alt={`Page ${page.page_number}`}
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-[#8C8275] italic">
                          No image preview
                        </div>
                      )}

                      <div className="absolute inset-0 bg-[#1C1917]/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="inline-flex items-center gap-1.5 bg-[#1C1917] text-white text-xs px-3 py-1.5 rounded-md shadow-xs">
                          <Maximize2 size={12} />
                          <span>View Full Image</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Text */}
                  <div className="lg:col-span-7 flex flex-col justify-between h-full">
                    {editingPageId === page.id ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#8A5832]">Editing Page {page.page_number}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setEditingPageId(null)}
                              className="px-2.5 py-1 text-xs text-[#6E6659] hover:text-[#1C1917] cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => saveEditPage(page.id)}
                              className="px-3 py-1 bg-[#1C1917] text-white text-xs font-medium rounded cursor-pointer hover:bg-[#2D2926]"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                        <textarea
                          value={editedContent}
                          onChange={(e) => setEditedContent(e.target.value)}
                          rows={14}
                          className="w-full p-3 font-serif text-sm bg-[#FAF8F5] border border-[#E7E2D8] rounded-md focus:outline-none focus:border-[#1C1917] leading-relaxed"
                        />
                      </div>
                    ) : (
                      <div className="prose prose-stone max-w-none text-[#1C1917] font-serif leading-relaxed text-sm sm:text-base max-h-[500px] overflow-y-auto archival-scroll pr-3">
                        <Markdown>{cleanTranscribedText(page.content || '')}</Markdown>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          /* Continuous Reading View */
          <div className="max-w-3xl mx-auto bg-white border border-[#E7E2D8] p-8 sm:p-12 space-y-12 shadow-xs">
            <div className="text-center border-b border-[#E7E2D8] pb-8">
              <h1 className="font-serif text-3xl sm:text-4xl font-bold text-[#1C1917]">
                {book.title}
              </h1>
              {book.author && (
                <p className="font-serif italic text-base text-[#6E6659] mt-1">
                  {book.author}
                </p>
              )}
            </div>

            {sortedPages.map((page) => (
              <div key={page.id} className="space-y-4">
                <div className="flex items-center gap-3 pt-6 border-t border-[#F0EBE1]">
                  <span className="text-xs font-bold text-[#8C8275]">
                    Page {page.page_number}
                  </span>
                  <div className="flex-1 h-px bg-[#F0EBE1]" />
                  {page.image_data && (
                    <button
                      onClick={() => setInspectImage({ url: page.image_data, pageNum: page.page_number })}
                      className="text-xs text-[#8C8275] hover:text-[#1C1917] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Eye size={12} />
                      <span>View scan</span>
                    </button>
                  )}
                </div>

                <div className="prose prose-stone max-w-none font-serif text-base sm:text-lg text-[#1C1917] leading-relaxed">
                  <Markdown>{cleanTranscribedText(page.content || '')}</Markdown>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Image Inspection Modal */}
      <AnimatePresence>
        {inspectImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#1C1917]/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
            onClick={() => setInspectImage(null)}
          >
            <div 
              className="relative max-w-4xl max-h-[90vh] bg-white border border-[#E7E2D8] p-2 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#E7E2D8] mb-2">
                <span className="text-xs text-[#1C1917] font-semibold">
                  Page {inspectImage.pageNum}
                </span>
                <button
                  onClick={() => setInspectImage(null)}
                  className="p-1 text-[#6E6659] hover:text-[#1C1917] cursor-pointer"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="overflow-auto max-h-[80vh] flex items-center justify-center bg-[#FAF8F5]">
                <img
                  src={inspectImage.url}
                  alt={`Page ${inspectImage.pageNum}`}
                  className="max-w-full max-h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
