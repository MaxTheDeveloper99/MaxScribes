export interface Book {
  id: number;
  title: string;
  author: string;
  status: string;
  due_date: string;
  created_at: string;
}

export interface Page {
  id: number;
  book_id: number;
  page_number: number;
  content: string;
  image_data: string;
  created_at: string;
}
