import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { Book } from '../types';
import { Plus, Trash2, Book as BookIcon, Calendar } from 'lucide-react';
import { motion } from 'motion/react';

interface BookListProps {
  onSelectBook: (book: Book) => void;
}

export default function BookList({ onSelectBook }: BookListProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [newBook, setNewBook] = useState({ title: '', author: '', due_date: '' });

  const { data: books, isLoading, error } = useQuery<Book[]>({
    queryKey: ['books'],
    queryFn: async () => {
      const res = await api.get('/books');
      if (!Array.isArray(res.data)) {
        throw new Error('Invalid data format received from server');
      }
      return res.data;
    },
  });

  const createBookMutation = useMutation({
    mutationFn: async (book: { title: string; author: string; due_date: string }) => {
      const res = await api.post('/books', book);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      setIsAdding(false);
      setNewBook({ title: '', author: '', due_date: '' });
    },
    onError: (error: any) => {
      alert(`Failed to create project: ${error.response?.data?.error || error.message}`);
    }
  });

  const updateBookMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await api.patch(`/books/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
    onError: (error: any) => {
      alert(`Failed to update project: ${error.response?.data?.error || error.message}`);
    }
  });

  const deleteBookMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/books/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
    },
    onError: (error: any) => {
      alert(`Failed to delete project: ${error.response?.data?.error || error.message}`);
    }
  });

  if (isLoading) return <div className="text-center py-20 text-[#5A5A40]">Loading library...</div>;

  if (error) {
    const errorMsg = (error as any).response?.data?.error || error.message || "";
    const isPausedOrMissing = errorMsg.includes("Project not found") || 
                              errorMsg.includes("Tenant or user not found") || 
                              errorMsg.includes("tenant/user") ||
                              errorMsg.includes("ENOTFOUND") ||
                              errorMsg.includes("getaddrinfo");

    return (
      <div className="max-w-xl mx-auto mt-8 bg-white rounded-3xl border border-[#5A5A40]/10 shadow-xl overflow-hidden font-sans">
        <div className="p-6 sm:p-8 bg-amber-50/50 border-b border-[#5A5A40]/10 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto text-amber-700 mb-4 animate-pulse">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-gray-900">Database Connection Failed</h3>
          <p className="text-sm text-gray-600 mt-1">We couldn't connect to your database. Let's get this resolved!</p>
        </div>

        <div className="p-6 sm:p-8 space-y-6">
          <div className="bg-[#F5F5F0] p-4 rounded-xl border border-[#5A5A40]/10">
            <span className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 block mb-1">Diagnostic Report:</span>
            <code className="text-xs text-red-600 font-mono break-all">{errorMsg}</code>
          </div>

          {isPausedOrMissing ? (
            <div className="space-y-4">
              <h4 className="font-bold text-gray-900 text-sm">💡 Potential Causes & How to Fix:</h4>
              <ul className="space-y-4 text-xs text-gray-600">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#5A5A40]/10 text-[#5A5A40] flex items-center justify-center font-bold">1</span>
                  <div>
                    <strong className="text-gray-900 block">Is your Supabase project paused?</strong>
                    Supabase automatically pauses inactive databases after a week on the free plan. If so, simply log into your <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-amber-700 hover:underline font-bold">Supabase Dashboard</a> and click <strong className="text-gray-900">Restore Project</strong>.
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#5A5A40]/10 text-[#5A5A40] flex items-center justify-center font-bold">2</span>
                  <div>
                    <strong className="text-gray-900 block">Check your Project ID/Reference</strong>
                    The error shows a failure resolving the tenant or host name. Double-check that your database secret in the <strong className="text-gray-900">Settings &gt; Secrets</strong> panel matches your current project.
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#5A5A40]/10 text-[#5A5A40] flex items-center justify-center font-bold">3</span>
                  <div>
                    <strong className="text-gray-900 block">Make sure you are using Connection Pooler (Port 6543)</strong>
                    Ensure your string uses the Transaction pooler port 6543 (e.g. `aws-0-[region].pooler.supabase.com:6543`).
                  </div>
                </li>
              </ul>
            </div>
          ) : (
            <div className="space-y-3 text-xs text-gray-600">
              <p>Please double check that your <strong className="text-gray-900">DATABASE_URL</strong> environment variable/secret in AI Studio is correct, your password has been entered correctly, and your database provider has not blocked the connection.</p>
            </div>
          )}

          <div className="pt-4 border-t border-gray-100 flex gap-3">
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['books'] })}
              className="flex-1 bg-[#5A5A40] text-white px-6 py-3 rounded-full font-semibold hover:bg-[#3A3A2A] transition-all shadow-lg active:scale-95 text-center text-sm"
            >
              🔄 Retry Connection
            </button>
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 bg-[#F5F5F0] border border-[#5A5A40]/10 text-[#5A5A40] hover:bg-[#EAEAE3] rounded-full font-semibold transition-colors text-center text-sm"
            >
              Go to Supabase
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-[#1A1A1A] truncate">Your Library</h2>
          <p className="text-[#5A5A40] mt-1 text-xs sm:text-sm lg:text-base">Manage your book transcription projects</p>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="w-full sm:w-auto bg-[#5A5A40] text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-full flex items-center justify-center gap-2 hover:bg-[#3A3A2A] transition-all shadow-lg hover:scale-105 active:scale-95 font-sans font-semibold text-sm sm:text-base whitespace-nowrap"
        >
          <Plus size={18} className="sm:size-5" />
          New Project
        </button>
      </div>

      {isAdding && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-5 sm:p-8 rounded-3xl shadow-xl border border-[#5A5A40]/10"
        >
          <h3 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6">Create New Project</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            <div className="space-y-1.5 sm:space-y-2">
              <label className="text-[10px] sm:text-xs uppercase tracking-widest font-sans font-bold text-[#5A5A40]/60">Book Title</label>
              <input
                type="text"
                placeholder="e.g. The Great Gatsby"
                className="w-full p-3 sm:p-4 bg-[#F5F5F0] rounded-xl border-none focus:ring-2 focus:ring-[#5A5A40] transition-all font-sans text-sm sm:text-base"
                value={newBook.title}
                onChange={(e) => setNewBook({ ...newBook, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:space-y-2">
              <label className="text-[10px] sm:text-xs uppercase tracking-widest font-sans font-bold text-[#5A5A40]/60">Author</label>
              <input
                type="text"
                placeholder="e.g. F. Scott Fitzgerald"
                className="w-full p-3 sm:p-4 bg-[#F5F5F0] rounded-xl border-none focus:ring-2 focus:ring-[#5A5A40] transition-all font-sans text-sm sm:text-base"
                value={newBook.author}
                onChange={(e) => setNewBook({ ...newBook, author: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:space-y-2">
              <label className="text-[10px] sm:text-xs uppercase tracking-widest font-sans font-bold text-[#5A5A40]/60">Due Date</label>
              <input
                type="date"
                className="w-full p-3 sm:p-4 bg-[#F5F5F0] rounded-xl border-none focus:ring-2 focus:ring-[#5A5A40] transition-all font-sans text-sm sm:text-base"
                value={newBook.due_date}
                onChange={(e) => setNewBook({ ...newBook, due_date: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-4 mt-6 sm:mt-8">
            <button
              onClick={() => setIsAdding(false)}
              className="w-full sm:w-auto px-6 py-2.5 sm:py-3 rounded-full font-sans font-semibold text-[#5A5A40] hover:bg-[#F5F5F0] transition-colors text-sm sm:text-base"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                console.log('Attempting to create project:', newBook);
                createBookMutation.mutate(newBook);
              }}
              disabled={!newBook.title || createBookMutation.isPending}
              className="w-full sm:w-auto px-8 py-2.5 sm:py-3 bg-[#5A5A40] text-white rounded-full font-sans font-semibold hover:bg-[#3A3A2A] transition-all disabled:opacity-50 text-sm sm:text-base"
            >
              {createBookMutation.isPending ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {Array.isArray(books) && books.map((book) => (
          <motion.div
            key={book.id}
            whileHover={{ y: -4 }}
            className="bg-white p-5 sm:p-6 rounded-3xl shadow-sm border border-[#5A5A40]/5 hover:shadow-xl transition-all group cursor-pointer relative"
            onClick={() => onSelectBook(book)}
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-[#F5F5F0] flex items-center justify-center text-[#5A5A40]">
                  <BookIcon size={20} className="sm:size-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-base sm:text-lg lg:text-xl font-bold group-hover:text-[#5A5A40] transition-colors truncate">{book.title}</h4>
                  <p className="text-[#5A5A40]/60 font-sans italic text-xs sm:text-sm lg:text-base truncate">{book.author || 'Unknown Author'}</p>
                </div>
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-2 sm:flex-shrink-0">
                <select
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    updateBookMutation.mutate({ id: book.id, status: e.target.value });
                  }}
                  value={book.status}
                  className="text-[10px] sm:text-xs font-sans font-bold uppercase tracking-widest bg-[#F5F5F0] border-none rounded-full px-3 py-1 text-[#5A5A40] focus:ring-0 cursor-pointer"
                >
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="on-hold">On Hold</option>
                </select>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Are you sure you want to delete this project?')) {
                      deleteBookMutation.mutate(book.id);
                    }
                  }}
                  className="p-2 text-[#5A5A40]/20 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            
            <div className="mt-4 sm:mt-8 pt-4 sm:pt-6 border-t border-[#F5F5F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[10px] sm:text-xs font-sans font-bold text-[#5A5A40]/40 uppercase tracking-widest">
              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-1.5">
                  <Calendar size={14} />
                  {new Date(book.created_at).toLocaleDateString()}
                </div>
                {book.due_date && (
                  <div className="flex items-center gap-1.5 text-amber-600">
                    <span className="opacity-50">Due:</span>
                    {new Date(book.due_date).toLocaleDateString()}
                  </div>
                )}
              </div>
              <div className={`self-start sm:self-auto px-3 py-1 rounded-full whitespace-nowrap ${book.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-[#F5F5F0] text-[#5A5A40]'}`}>
                {book.status}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {books?.length === 0 && !isAdding && (
        <div className="text-center py-20 bg-white/30 rounded-3xl border-2 border-dashed border-[#5A5A40]/10">
          <BookIcon size={48} className="mx-auto text-[#5A5A40]/20 mb-4" />
          <p className="text-[#5A5A40]/60 italic">Your library is empty. Create your first project to begin.</p>
        </div>
      )}
    </div>
  );
}
