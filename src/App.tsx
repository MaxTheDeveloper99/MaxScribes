import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BookList from './components/BookList';
import BookDetail from './components/BookDetail';
import { Book } from './types';
import { BookOpen, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const queryClient = new QueryClient();

export default function App() {
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-[#F5F5F0] text-[#1A1A1A] font-serif">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#5A5A40]/10 px-6 py-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div 
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => setSelectedBook(null)}
            >
              <div className="w-10 h-10 rounded-full bg-[#5A5A40] flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform">
                <BookOpen size={20} />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">MaxiScribe</h1>
            </div>
            
            {selectedBook && (
              <button 
                onClick={() => setSelectedBook(null)}
                className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-sans font-medium text-[#5A5A40] hover:text-[#3A3A2A] transition-colors"
              >
                <ChevronLeft size={16} />
                <span className="hidden xs:inline">Back to Library</span>
                <span className="xs:hidden">Back</span>
              </button>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-5xl mx-auto px-6 py-12">
          <AnimatePresence mode="wait">
            {!selectedBook ? (
              <motion.div
                key="list"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
              >
                <BookList onSelectBook={setSelectedBook} />
              </motion.div>
            ) : (
              <motion.div
                key="detail"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4 }}
              >
                <BookDetail book={selectedBook} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Footer */}
        <footer className="mt-20 border-t border-[#5A5A40]/10 py-12 px-6 bg-white/50">
          <div className="max-w-5xl mx-auto text-center">
            <p className="text-sm text-[#5A5A40]/60 font-sans">
              &copy; 2026 LibrisScribe. Powered by Gemini AI for high-fidelity transcription.
            </p>
          </div>
        </footer>
      </div>
    </QueryClientProvider>
  );
}
