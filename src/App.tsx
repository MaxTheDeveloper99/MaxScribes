import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BookList from './components/BookList';
import BookDetail from './components/BookDetail';
import { Book } from './types';
import { ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App() {
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen flex flex-col bg-[#FAF8F5] text-[#1C1917] selection:bg-[#E8DFD3]">
        {/* Clean, Human Top Navigation Bar */}
        <header className="sticky top-0 z-40 bg-[#FAF8F5]/90 backdrop-blur-md border-b border-[#E7E2D8] px-4 sm:px-8">
          <div className="max-w-6xl mx-auto h-16 flex items-center justify-between gap-4">
            {/* Logo / Brand Name: Pure typography without black box icon or AI tags */}
            <div 
              className="cursor-pointer"
              onClick={() => setSelectedBook(null)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setSelectedBook(null); }}
            >
              <span className="font-serif text-2xl font-bold tracking-tight text-[#1C1917]">
                MaxiScribe
              </span>
            </div>

            {/* Right Action / Context */}
            <div>
              {selectedBook && (
                <button
                  onClick={() => setSelectedBook(null)}
                  className="flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#6E6659] hover:text-[#1C1917] transition-colors py-1 cursor-pointer"
                >
                  <ChevronLeft size={16} />
                  <span>Back to Library</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <AnimatePresence mode="wait">
            {!selectedBook ? (
              <motion.div
                key="list"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <BookList onSelectBook={setSelectedBook} />
              </motion.div>
            ) : (
              <motion.div
                key={`detail-${selectedBook.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <BookDetail 
                  book={selectedBook} 
                  onBack={() => setSelectedBook(null)}
                  onUpdateBook={(updated) => setSelectedBook(updated)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Clean, Simple Footer: Terminates page flow cleanly without trailing space */}
        <footer className="mt-auto border-t border-[#E7E2D8] bg-[#FAF8F5] py-6 px-4 sm:px-8">
          <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-[#8C8275]">
            <span className="font-serif font-semibold text-[#1C1917]">MaxiScribe</span>
            <span>&copy; {new Date().getFullYear()}</span>
          </div>
        </footer>
      </div>
    </QueryClientProvider>
  );
}
