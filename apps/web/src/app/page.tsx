import { redirect } from 'next/navigation';
import { homeForRole } from '@protarget/shared';
import { requireUser } from '@/lib/server';
export default async function Home() { redirect(homeForRole((await requireUser()).role)); }
