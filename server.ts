import express from "express";
import path from "path";
import fs from "fs";
import { Pool } from "pg";
import multer from "multer";

// PostgreSQL connection pool
const connectionString = (process.env.DATABASE_URL || "").trim();
// Add pgbouncer=true if using Supabase pooler (port 6543) and it's missing
const finalConnectionString = (connectionString.includes(':6543') && !connectionString.includes('pgbouncer=true'))
  ? `${connectionString}${connectionString.includes('?') ? '&' : '?'}pgbouncer=true`
  : connectionString;

const pool = new Pool({
  connectionString: finalConnectionString,
  ssl: process.env.DATABASE_URL ? {
    rejectUnauthorized: false
  } : false
});

// Helper check for DATABASE_URL configuration issues
function getDbUrlValidationError(): string | null {
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (!dbUrl) {
    return "DATABASE_URL environment variable is missing.";
  }
  if (dbUrl.toLowerCase().includes("tenant/user") || dbUrl.toLowerCase().includes("not found")) {
    return "DATABASE_URL secret contains a 'tenant/user not found' error message.";
  }
  if (!dbUrl.startsWith("postgres://") && !dbUrl.startsWith("postgresql://")) {
    return "DATABASE_URL does not start with postgres:// or postgresql://.";
  }
  return null;
}

// In-Memory store fallback
interface InMemoryBook {
  id: number;
  title: string;
  author: string | null;
  status: string;
  due_date: string | null;
  created_at: string;
}

interface InMemoryPage {
  id: number;
  book_id: number;
  page_number: number;
  content: string | null;
  image_data: string | null;
  created_at: string;
}

let inMemoryBooks: InMemoryBook[] = [
  {
    id: 1,
    title: "My Transcription Project",
    author: "MaxiScribe Demo",
    status: "active",
    due_date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split('T')[0],
    created_at: new Date().toISOString()
  }
];

let inMemoryPages: InMemoryPage[] = [];
let nextBookId = 2;
let nextPageId = 1;

// Database helper functions with automatic in-memory fallback
async function dbGetBooks(): Promise<InMemoryBook[]> {
  const dbValidationError = getDbUrlValidationError();
  if (!dbValidationError) {
    try {
      const result = await pool.query("SELECT * FROM books ORDER BY created_at DESC");
      return result.rows;
    } catch (err: any) {
      console.warn("Postgres query failed, falling back to in-memory store:", err.message);
    }
  }
  return [...inMemoryBooks].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

async function dbCreateBook(title: string, author: string, due_date: string): Promise<InMemoryBook> {
  const dbValidationError = getDbUrlValidationError();
  if (!dbValidationError) {
    try {
      const result = await pool.query(
        "INSERT INTO books (title, author, due_date) VALUES ($1, $2, $3) RETURNING *",
        [title, author, due_date]
      );
      return result.rows[0];
    } catch (err: any) {
      console.warn("Postgres create book failed, falling back to in-memory store:", err.message);
    }
  }
  const newBook: InMemoryBook = {
    id: nextBookId++,
    title: title || "Untitled Project",
    author: author || null,
    status: "active",
    due_date: due_date || null,
    created_at: new Date().toISOString()
  };
  inMemoryBooks.push(newBook);
  return newBook;
}

async function dbUpdateBook(id: string, status?: string, due_date?: string): Promise<boolean> {
  const dbValidationError = getDbUrlValidationError();
  if (!dbValidationError) {
    try {
      if (status !== undefined && due_date !== undefined) {
        await pool.query("UPDATE books SET status = $1, due_date = $2 WHERE id = $3", [status, due_date, id]);
      } else if (status !== undefined) {
        await pool.query("UPDATE books SET status = $1 WHERE id = $2", [status, id]);
      } else if (due_date !== undefined) {
        await pool.query("UPDATE books SET due_date = $1 WHERE id = $2", [due_date, id]);
      }
      return true;
    } catch (err: any) {
      console.warn("Postgres update book failed, falling back to in-memory store:", err.message);
    }
  }
  const numId = Number(id);
  const book = inMemoryBooks.find(b => b.id === numId);
  if (book) {
    if (status !== undefined) book.status = status;
    if (due_date !== undefined) book.due_date = due_date;
  }
  return true;
}

async function dbDeleteBook(id: string): Promise<boolean> {
  const dbValidationError = getDbUrlValidationError();
  if (!dbValidationError) {
    try {
      await pool.query("DELETE FROM books WHERE id = $1", [id]);
      return true;
    } catch (err: any) {
      console.warn("Postgres delete book failed, falling back to in-memory store:", err.message);
    }
  }
  const numId = Number(id);
  inMemoryBooks = inMemoryBooks.filter(b => b.id !== numId);
  inMemoryPages = inMemoryPages.filter(p => p.book_id !== numId);
  return true;
}

async function dbGetPages(book_id: string): Promise<InMemoryPage[]> {
  const dbValidationError = getDbUrlValidationError();
  if (!dbValidationError) {
    try {
      const result = await pool.query("SELECT * FROM pages WHERE book_id = $1 ORDER BY page_number ASC", [book_id]);
      return result.rows;
    } catch (err: any) {
      console.warn("Postgres get pages failed, falling back to in-memory store:", err.message);
    }
  }
  const numBookId = Number(book_id);
  return inMemoryPages
    .filter(p => p.book_id === numBookId)
    .sort((a, b) => a.page_number - b.page_number);
}

async function dbCreatePage(book_id: string, page_number: number, content: string, image_data: string | null): Promise<InMemoryPage> {
  const dbValidationError = getDbUrlValidationError();
  if (!dbValidationError) {
    try {
      const result = await pool.query(
        "INSERT INTO pages (book_id, page_number, content, image_data) VALUES ($1, $2, $3, $4) RETURNING *",
        [book_id, page_number, content, image_data]
      );
      return result.rows[0];
    } catch (err: any) {
      console.warn("Postgres create page failed, falling back to in-memory store:", err.message);
    }
  }
  const newPage: InMemoryPage = {
    id: nextPageId++,
    book_id: Number(book_id),
    page_number: Number(page_number),
    content: content || null,
    image_data: image_data || null,
    created_at: new Date().toISOString()
  };
  inMemoryPages.push(newPage);
  return newPage;
}

async function dbUpdatePage(id: string, content?: string, page_number?: number): Promise<boolean> {
  const dbValidationError = getDbUrlValidationError();
  if (!dbValidationError) {
    try {
      if (content !== undefined && page_number !== undefined) {
        await pool.query("UPDATE pages SET content = $1, page_number = $2 WHERE id = $3", [content, page_number, id]);
      } else if (content !== undefined) {
        await pool.query("UPDATE pages SET content = $1 WHERE id = $2", [content, id]);
      } else if (page_number !== undefined) {
        await pool.query("UPDATE pages SET page_number = $1 WHERE id = $2", [page_number, id]);
      }
      return true;
    } catch (err: any) {
      console.warn("Postgres update page failed, falling back to in-memory store:", err.message);
    }
  }
  const numId = Number(id);
  const page = inMemoryPages.find(p => p.id === numId);
  if (page) {
    if (content !== undefined) page.content = content;
    if (page_number !== undefined) page.page_number = Number(page_number);
  }
  return true;
}

// Initialize database tables
const initDb = async () => {
  const dbValidationError = getDbUrlValidationError();
  if (dbValidationError) {
    console.warn(`Database connection skipped: ${dbValidationError}. Using in-memory store.`);
    return;
  }

  try {
    const url = new URL(connectionString);
    console.log(`Attempting to connect to host: ${url.host}, database: ${url.pathname}`);
  } catch (e) {
    console.warn("Could not parse DATABASE_URL for logging.");
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS books (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        status TEXT DEFAULT 'active',
        due_date TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS pages (
        id SERIAL PRIMARY KEY,
        book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL,
        content TEXT,
        image_data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await pool.query("ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_data TEXT");
    } catch (e) {
      // column already exists
    }

    console.log("Database tables initialized successfully");
  } catch (err: any) {
    console.warn("Could not initialize PostgreSQL database. In-memory storage will be used as fallback:", err.message);
  }
};

initDb();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Setup multer for image uploads (Using memory storage for Vercel/Serverless compatibility)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// API Routes
app.get("/api/books", async (req, res) => {
  try {
    const books = await dbGetBooks();
    res.json(books);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch books: ${err.message}` });
  }
});

app.post("/api/books", async (req, res) => {
  const { title, author, due_date } = req.body;
  try {
    const book = await dbCreateBook(title, author, due_date);
    res.json(book);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to create book: ${err.message}` });
  }
});

app.patch("/api/books/:id", async (req, res) => {
  const { status, due_date } = req.body;
  try {
    await dbUpdateBook(req.params.id, status, due_date);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to update book: ${err.message}` });
  }
});

app.delete("/api/books/:id", async (req, res) => {
  try {
    await dbDeleteBook(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to delete book: ${err.message}` });
  }
});

app.get("/api/books/:id/pages", async (req, res) => {
  try {
    const pages = await dbGetPages(req.params.id);
    res.json(pages);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch pages: ${err.message}` });
  }
});

app.post("/api/books/:id/pages", upload.single("image"), async (req, res) => {
  const { page_number, content } = req.body;
  const book_id = req.params.id;
  
  let image_data = null;
  if (req.file) {
    const base64Image = req.file.buffer.toString('base64');
    image_data = `data:${req.file.mimetype};base64,${base64Image}`;
  }

  try {
    const page = await dbCreatePage(book_id, Number(page_number), content, image_data);
    res.json(page);
  } catch (err: any) {
    console.error("Error creating page:", err);
    res.status(500).json({ error: `Failed to create page: ${err.message}` });
  }
});

app.patch("/api/pages/:id", async (req, res) => {
  const { content, page_number } = req.body;
  try {
    await dbUpdatePage(req.params.id, content, page_number);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to update page: ${err.message}` });
  }
});

// Serve uploaded images
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Vite middleware for development or Static serving for production
if (process.env.NODE_ENV !== "production") {
  const startDevServer = async () => {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  };
  startDevServer();
} else {
  app.use(express.static("dist"));
  
  app.get("*", (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API route not found' });
    }
    const indexPath = path.join(process.cwd(), "dist/index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send("Frontend build not found. Please run 'npm run build'.");
    }
  });

  if (process.env.VERCEL !== '1') {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  }
}

export default app;
