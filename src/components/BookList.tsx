import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { Book } from '../types';
import { Plus, Trash2, BookOpen, Search, ArrowRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface BookListProps {
  onSelectBook: (book: Book) => void;
}

export default function BookList({ onSelectBook }: BookListProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'on-hold'>('all');
  const [newBook, setNewBook] = useState({ title: '', author: '', status: 'active' });

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
    mutationFn: async (book: { title: string; author: string; status?: string }) => {
      const res = await api.post('/books', book);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      setIsAdding(false);
      setNewBook({ title: '', author: '', status: 'active' });
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

  const formatDisplayDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const normalized = typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T')
        ? dateStr.replace(' ', 'T')
        : dateStr;
      const d = new Date(normalized);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return '';
    }
  };

  const filteredBooks = useMemo(() => {
    if (!books || !Array.isArray(books)) return [];
    return books.filter((book) => {
      if (!book) return false;
      const title = (book.title || '').toLowerCase();
      const author = (book.author || '').toLowerCase();
      const q = (searchQuery || '').toLowerCase();
      const matchesSearch = title.includes(q) || author.includes(q);
      const matchesStatus = statusFilter === 'all' || (book.status || 'active') === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [books, searchQuery, statusFilter]);

  if (isLoading) {
    return (
      <div className="py-24 text-center">
        <div className="inline-block w-6 h-6 border-2 border-[#1C1917] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-[#6E6659]">Loading library...</p>
      </div>
    );
  }

  if (error) {
    const errorMsg = (error as any).response?.data?.error || error.message || "";
    const isPausedOrMissing = errorMsg.includes("Project not found") || 
                              errorMsg.includes("Tenant or user not found") || 
                              errorMsg.includes("tenant/user") ||
                              errorMsg.includes("ENOTFOUND") ||
                              errorMsg.includes("getaddrinfo");

    return (
      <div className="max-w-2xl mx-auto my-12 bg-white border border-[#E7E2D8] p-8 shadow-xs">
        <div className="border-b border-[#E7E2D8] pb-5 mb-6">
          <h3 className="font-serif text-2xl font-bold text-[#1C1917]">Database Connection Failed</h3>
          <p className="text-sm text-[#6E6659] mt-1">
            Could not connect to the database.
          </p>
        </div>

        <div className="space-y-5 text-sm text-[#3D3833]">
          <div className="bg-[#FAF8F5] p-3.5 border border-[#E7E2D8] font-mono text-xs text-[#8A5832] break-all">
            {errorMsg}
          </div>

          {isPausedOrMissing ? (
            <div className="space-y-3">
              <h4 className="font-semibold text-xs text-[#1C1917]">Troubleshooting Steps:</h4>
              <ul className="space-y-2 text-xs text-[#6E6659]">
                <li className="flex items-start gap-2">
                  <span className="font-mono text-[#1C1917]">1.</span>
                  <span><strong>Supabase Paused:</strong> Free databases pause after 7 days of inactivity. Go to your Supabase Dashboard and click "Restore Project".</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono text-[#1C1917]">2.</span>
                  <span><strong>Port 6543:</strong> Make sure your connection string uses port 6543 (transaction pooler).</span>
                </li>
              </ul>
            </div>
          ) : (
            <p className="text-xs text-[#6E6659]">
              Please check your database configuration and try again.
            </p>
          )}

          <div className="pt-4 border-t border-[#E7E2D8] flex items-center gap-3">
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['books'] })}
              className="bg-[#1C1917] text-[#FAF8F5] px-4 py-2 text-xs font-medium rounded-md hover:bg-[#2D2926] transition-colors cursor-pointer"
            >
              Retry Connection
            </button>
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="border border-[#E7E2D8] px-4 py-2 text-xs font-medium text-[#6E6659] hover:text-[#1C1917] rounded-md transition-colors"
            >
              Open Supabase
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b border-[#E7E2D8] pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-[#1C1917]">
              Your Library
            </h1>
            <p className="mt-1 text-sm text-[#6E6659]">
              Upload book pages and transcribe them into digital documents.
            </p>
          </div>
          
          <button
            onClick={() => setIsAdding(true)}
            className="self-start sm:self-auto inline-flex items-center gap-2 bg-[#1C1917] hover:bg-[#2D2926] text-[#FAF8F5] px-4 py-2 text-xs font-medium rounded-md shadow-xs transition-colors cursor-pointer"
          >
            <Plus size={16} />
            <span>New Project</span>
          </button>
        </div>

        {/* Filter and Search Bar */}
        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-4 border-t border-[#F0EBE1]">
          {/* Filter tabs */}
          <div className="flex items-center gap-1 p-1 bg-[#F0EBE1] rounded-md self-start">
            {(['all', 'active', 'completed', 'on-hold'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors capitalize cursor-pointer ${
                  statusFilter === filter
                    ? 'bg-white text-[#1C1917] shadow-2xs font-semibold'
                    : 'text-[#6E6659] hover:text-[#1C1917]'
                }`}
              >
                {filter === 'all' ? 'All Projects' : filter.replace('-', ' ')}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-60">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8C8275]" />
            <input
              type="text"
              placeholder="Search by title or author..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-[#E7E2D8] rounded-md placeholder-[#A0988A] focus:outline-none focus:border-[#1C1917] transition-colors"
            />
          </div>
        </div>
      </div>

      {/* New Project Modal */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#1C1917]/40 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              className="w-full max-w-lg bg-white border border-[#E7E2D8] p-6 sm:p-8 shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-[#E7E2D8] pb-4 mb-6">
                <h3 className="font-serif text-2xl font-bold text-[#1C1917]">Create New Project</h3>
                <button
                  onClick={() => setIsAdding(false)}
                  className="text-[#8C8275] hover:text-[#1C1917] p-1 transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-[#1C1917] block mb-1.5">
                    Title <span className="text-[#8A5832]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Principles of Hunger and Thirst Track 1"
                    className="w-full p-2.5 bg-[#FAF8F5] border border-[#E7E2D8] text-sm text-[#1C1917] placeholder-[#A0988A] rounded-md focus:outline-none focus:border-[#1C1917] transition-colors"
                    value={newBook.title}
                    onChange={(e) => setNewBook({ ...newBook, title: e.target.value })}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-[#1C1917] block mb-1.5">
                    Author / Speaker
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Pastor Moni"
                    className="w-full p-2.5 bg-[#FAF8F5] border border-[#E7E2D8] text-sm text-[#1C1917] placeholder-[#A0988A] rounded-md focus:outline-none focus:border-[#1C1917] transition-colors"
                    value={newBook.author}
                    onChange={(e) => setNewBook({ ...newBook, author: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-[#1C1917] block mb-1.5">
                    Initial Status
                  </label>
                  <select
                    className="w-full p-2.5 bg-[#FAF8F5] border border-[#E7E2D8] text-sm text-[#1C1917] rounded-md focus:outline-none focus:border-[#1C1917] transition-colors cursor-pointer capitalize"
                    value={newBook.status}
                    onChange={(e) => setNewBook({ ...newBook, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="on-hold">On Hold</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-8 pt-4 border-t border-[#E7E2D8]">
                <button
                  onClick={() => setIsAdding(false)}
                  className="px-4 py-2 text-xs font-medium text-[#6E6659] hover:text-[#1C1917] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => createBookMutation.mutate(newBook)}
                  disabled={!newBook.title.trim() || createBookMutation.isPending}
                  className="bg-[#1C1917] text-[#FAF8F5] px-5 py-2 text-xs font-medium rounded-md hover:bg-[#2D2926] disabled:opacity-40 transition-colors cursor-pointer"
                >
                  {createBookMutation.isPending ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filteredBooks.map((book) => {
          const isCompleted = book.status === 'completed';
          const isOnHold = book.status === 'on-hold';

          return (
            <article
              key={book.id}
              onClick={() => onSelectBook(book)}
              className="group bg-white border border-[#E7E2D8] hover:border-[#C8BFB0] p-6 transition-all duration-200 cursor-pointer flex flex-col justify-between hover:shadow-xs"
            >
              <div>
                {/* Header Line: Interactive Status Selector */}
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 bg-[#FAF8F5] border border-[#E7E2D8] hover:border-[#1C1917] px-2 py-0.5 rounded text-xs transition-colors"
                  >
                    <span 
                      className={`w-2 h-2 rounded-full ${
                        isCompleted 
                          ? 'bg-emerald-600' 
                          : isOnHold 
                          ? 'bg-amber-600' 
                          : 'bg-stone-500'
                      }`} 
                    />
                    <select
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateBookMutation.mutate({ id: book.id, status: e.target.value });
                      }}
                      value={book.status || 'active'}
                      className="bg-transparent text-xs font-medium text-[#1C1917] cursor-pointer focus:outline-none capitalize pr-1"
                    >
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                      <option value="on-hold">On Hold</option>
                    </select>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete project "${book.title}"?`)) {
                        deleteBookMutation.mutate(book.id);
                      }
                    }}
                    className="p-1 text-[#B0A799] hover:text-rose-700 transition-colors cursor-pointer"
                    title="Delete project"
                    aria-label="Delete project"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Title & Author */}
                <h2 className="font-serif text-xl sm:text-2xl font-bold text-[#1C1917] group-hover:text-[#8A5832] transition-colors leading-snug line-clamp-2">
                  {book.title}
                </h2>
                
                {book.author && (
                  <p className="mt-1 text-sm text-[#6E6659] italic font-serif truncate">
                    {book.author}
                  </p>
                )}
              </div>

              {/* Card Footer */}
              <div className="mt-6 pt-4 border-t border-[#F0EBE1] flex items-center justify-between text-xs text-[#8C8275]">
                <div>
                  <span>{book.created_at ? `Created ${formatDisplayDate(book.created_at)}` : ''}</span>
                </div>

                <span className="text-[#1C1917] group-hover:translate-x-0.5 transition-transform flex items-center gap-1 font-medium text-xs">
                  <span>Open</span>
                  <ArrowRight size={13} />
                </span>
              </div>
            </article>
          );
        })}
      </div>

      {/* Empty States */}
      {filteredBooks.length === 0 && !isAdding && (
        <div className="text-center py-20 bg-white border border-[#E7E2D8] p-8">
          <BookOpen size={36} className="mx-auto text-[#B0A799] mb-3 stroke-1" />
          <h3 className="font-serif text-xl font-semibold text-[#1C1917]">
            {searchQuery ? 'No matching projects found' : 'Your library is empty'}
          </h3>
          <p className="text-sm text-[#6E6659] mt-1 max-w-sm mx-auto">
            {searchQuery 
              ? 'Try adjusting your search terms.' 
              : 'Create your first project to begin uploading and transcribing pages.'}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setIsAdding(true)}
              className="mt-5 inline-flex items-center gap-1.5 bg-[#1C1917] text-[#FAF8F5] px-4 py-2 text-xs font-medium rounded-md hover:bg-[#2D2926] transition-colors cursor-pointer"
            >
              <Plus size={14} />
              Create First Project
            </button>
          )}
        </div>
      )}
    </div>
  );
}
