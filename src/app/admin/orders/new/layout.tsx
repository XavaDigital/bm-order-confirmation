// The new-order page is a client component, so its tab title lives on this
// pass-through layout ("OrderFlow - New Order" via the root template).
export const metadata = { title: 'New Order' };

export default function NewOrderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
