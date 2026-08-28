# LibrisScribe - Book Page Transcription & Ordering

LibrisScribe is a full-stack application designed to digitize physical books by transcribing page images into structured, ordered text.

## Features

- **Project Management**: Organize transcriptions into books/projects.
- **AI-Powered OCR**: Uses Gemini 3 Flash to extract high-fidelity text from images.
- **Automatic Ordering**: Detects page numbers and organizes content numerically.
- **Rich Text Display**: Renders transcribed text with Markdown support.
- **Export**: Download the entire book's transcription as a single text file.
- **Responsive Design**: Warm, organic UI optimized for both desktop and mobile.

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS 4, Motion, Lucide Icons.
- **Backend**: Node.js, Express.
- **Database**: PostgreSQL (e.g. Supabase).
- **AI**: Google Gemini API (@google/genai).
- **Hosting**: Prepared for Vercel.

## Setup Instructions

1. **Environment Variables**:
   - `GEMINI_API_KEY`: Required for OCR functionality.
   - `DATABASE_URL`: PostgreSQL connection string (e.g. from Supabase).
   - `APP_URL`: Used for internal routing.

2. **Vercel Deployment**:
   - Connect your repository to Vercel.
   - Add the environment variables in the Vercel dashboard.
   - Vercel will use `vercel.json` to build and serve the app.
   - **Note**: Local image storage via `multer` will not persist on Vercel. For production, consider integrating Supabase Storage or Cloudinary.

3. **Usage**:
   - Create a new project.
   - Upload images of book pages (JPG/PNG).
   - Wait for AI processing.
   - Review and download your transcription.

## API Documentation

- `GET /api/books`: List all projects.
- `POST /api/books`: Create a new project.
- `DELETE /api/books/:id`: Delete a project.
- `GET /api/books/:id/pages`: Get all transcribed pages for a book.
- `POST /api/books/:id/pages`: Upload an image and its transcription.
- `PATCH /api/pages/:id`: Update page content or number.

## Future Improvements

- **Batch Processing**: Parallelize image uploads for faster processing.
- **Manual Editing**: Add a built-in text editor for manual corrections.
- **Multi-format Export**: Support PDF, EPUB, and DOCX exports.
- **User Authentication**: Allow multiple users to have private libraries.
