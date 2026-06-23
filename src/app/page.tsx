import { redirect } from 'next/navigation';

// Root redirects to admin dashboard; middleware handles the auth redirect to /login.
export default function Home() {
  redirect('/admin/dashboard');
}
