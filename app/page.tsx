'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths } from 'date-fns';

type Job = {
  id: string;
  title: string;
  description?: string;
  status: string;
  scheduled_date?: string;
  customer_name?: string;
  customer_phone?: string;
  address?: string;
  notes?: string;
  photos?: string[];
  estimated_hours?: number;
  hourly_rate?: number;
  material_cost?: number;
  markup_percent?: number;
  total_estimate?: number;
};

type Todo = {
  id: string;
  title: string;
  completed: boolean;
};

function toLocalInput(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read that image');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));
  if (!blob) throw new Error('Could not read that image');
  return blob;
}

type Customer = {
  name: string;
  phone?: string;
  address?: string;
  email?: string;
};

function readEmail(notes?: string) {
  const match = (notes || '').match(/^@@email:(.*?)@@\n?/);
  return match ? match[1] : '';
}

function readNotes(notes?: string) {
  return (notes || '').replace(/^@@email:.*?@@\n?/, '');
}

function packNotes(email: string, notes: string) {
  const clean = readNotes(notes).trim();
  const trimmed = email.trim();
  if (!trimmed) return clean || null;
  return `@@email:${trimmed}@@${clean ? `\n${clean}` : ''}`;
}

function ContactActions({ phone, address }: { phone?: string; address?: string }) {
  const tel = (phone || '').replace(/[^\d+]/g, '');
  if (!tel && !address) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {tel && <a href={`tel:${tel}`} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm">Call</a>}
      {tel && <a href={`sms:${tel}`} className="px-3 py-1.5 rounded border text-sm">Text</a>}
      {address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded border text-sm">Directions</a>}
    </div>
  );
}

function customerDirectory(jobs: Job[], saved: Customer[]): Customer[] {
  const map = new Map<string, Customer>();
  for (const job of [...jobs].reverse()) {
    const name = (job.customer_name || '').trim();
    const key = name.toLowerCase();
    if (!key) continue;
    map.set(key, { name, phone: job.customer_phone || '', address: job.address || '', email: readEmail(job.notes) });
  }
  for (const customer of saved) {
    const name = (customer.name || '').trim();
    const key = name.toLowerCase();
    if (!key) continue;
    map.set(key, { name, phone: customer.phone || '', address: customer.address || '' });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'calendar' | 'unscheduled' | 'completed' | 'todos' | 'customers' | 'estimator'>('calendar');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [savedCustomers, setSavedCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [showJobModal, setShowJobModal] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);

  const [estHours, setEstHours] = useState(2);
  const [estRate, setEstRate] = useState(75);
  const [estMaterials, setEstMaterials] = useState(50);
  const [estMarkup, setEstMarkup] = useState(20);

  const labor = estHours * estRate;
  const materialsWithMarkup = estMaterials * (1 + estMarkup / 100);
  const totalEstimate = labor + materialsWithMarkup;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    fetchData();
    const channel = supabase
      .channel('public:jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session]);

  async function fetchData() {
    const { data: jobsData } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    const { data: todosData } = await supabase.from('todos').select('*').order('created_at', { ascending: false });
    const { data: customerData } = await supabase.from('customers').select('name, phone, address').order('name');
    setJobs(jobsData || []);
    setTodos(todosData || []);
    setSavedCustomers(customerData || []);
    setLoading(false);
  }

  async function rememberCustomer(jobData: any) {
    const name = (jobData.customer_name || '').trim();
    if (!name) return;
    const phone = jobData.customer_phone || null;
    const address = jobData.address || null;
    const { data, error } = await supabase.from('customers').select('id, name').ilike('name', name);
    if (error) return;
    const existing = (data || []).find((row: any) => row.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      await supabase.from('customers').update({ name, phone, address }).eq('id', existing.id);
    } else {
      await supabase.from('customers').insert({ name, phone, address });
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
  }

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) alert(error.message);
    else alert('Check your email for the confirmation link!');
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function saveJob(jobData: any, newPhotos: File[]) {
    let jobId = editingJob?.id;
    const photoUrls = [...(editingJob?.photos || [])];
    const failed: string[] = [];

    for (const file of newPhotos) {
      try {
        const blob = await compressImage(file);
        const dataUrl = await blobToDataUrl(blob);
        const base64 = dataUrl.split(',')[1];
        if (!base64) throw new Error('empty');
        photoUrls.push('b64:' + base64);
      } catch {
        failed.push(file.name || 'photo');
      }
    }
    if (failed.length) alert('Could not save: ' + failed.join(', '));
    jobData.photos = photoUrls;

    if (jobId) {
      const { error } = await supabase.from('jobs').update(jobData).eq('id', jobId);
      if (error) { alert(error.message); return; }
    } else {
      const { error } = await supabase.from('jobs').insert(jobData);
      if (error) { alert(error.message); return; }
    }
    await rememberCustomer(jobData);
    setShowJobModal(false);
    setEditingJob(null);
    if (jobData.scheduled_date && jobData.status === 'scheduled') {
      const when = new Date(jobData.scheduled_date);
      setActiveTab('calendar');
      setSelectedDate(when);
      setCurrentMonth(when);
    } else if (jobData.status === 'completed') {
      setActiveTab('completed');
    } else {
      setActiveTab('unscheduled');
    }
    await fetchData();
  }

  async function setJobCompleted(id: string, completed: boolean) {
    const { error } = await supabase.from('jobs').update({ status: completed ? 'completed' : 'scheduled' }).eq('id', id);
    if (error) { alert(error.message); return; }
    await fetchData();
  }

  async function deleteJob(id: string) {
    if (!confirm('Delete this job?')) return;
    const { error } = await supabase.from('jobs').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    await fetchData();
  }

  async function addTodo(title: string) {
    const { error } = await supabase.from('todos').insert({ title });
    if (error) { alert(error.message); return; }
    await fetchData();
  }

  async function toggleTodo(id: string, completed: boolean) {
    const { error } = await supabase.from('todos').update({ completed: !completed }).eq('id', id);
    if (error) { alert(error.message); return; }
    await fetchData();
  }

  async function deleteTodo(id: string) {
    const { error } = await supabase.from('todos').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    await fetchData();
  }

  if (authLoading) return <div className="p-8 text-center">Loading...</div>;
  if (!session) return <AuthScreen onSignIn={signIn} onSignUp={signUp} />;
  if (loading) return <div className="p-8 text-center">Loading jobs...</div>;

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const customers = customerDirectory(jobs, savedCustomers);
  const jobsOnDate = (date: Date) => jobs.filter(j => j.scheduled_date && (j.status === 'scheduled' || j.status === 'completed') && isSameDay(new Date(j.scheduled_date), date));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex justify-between items-center sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold">Job Manager</h1>
          <p className="text-xs text-gray-500 truncate max-w-[200px] sm:max-w-none">{session.user.email}</p>
        </div>
        <button onClick={signOut} className="text-sm text-gray-600 px-2 py-1">Sign out</button>
      </header>

      {/* Mobile-friendly nav */}
      <nav className="bg-white border-b flex overflow-x-auto px-2 sticky top-[57px] z-10">
        {(['calendar', 'unscheduled', 'completed', 'todos', 'customers', 'estimator'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-3 py-3 text-sm font-medium capitalize whitespace-nowrap flex-shrink-0 ${activeTab === tab ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}>
            {tab === 'todos' ? 'Task List' : tab}
          </button>
        ))}
        {(activeTab === 'calendar' || activeTab === 'unscheduled') && (
          <button onClick={() => { setEditingJob(null); setShowJobModal(true); }} className="ml-auto px-3 py-3 text-sm text-blue-600 whitespace-nowrap">+ Job</button>
        )}
      </nav>

      <main className="p-3 sm:p-4 max-w-7xl mx-auto pb-20">
        {activeTab === 'calendar' && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-semibold">{format(currentMonth, 'MMMM yyyy')}</h2>
              <div className="flex gap-1">
                <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="px-2 py-1 border rounded text-sm">Prev</button>
                <button onClick={() => setCurrentMonth(new Date())} className="px-2 py-1 border rounded text-sm">Today</button>
                <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="px-2 py-1 border rounded text-sm">Next</button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-xs font-medium text-gray-500 mb-1">
              {['S','M','T','W','T','F','S'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-xs">
              {days.map(day => {
                const dayJobs = jobsOnDate(day);
                const isToday = isSameDay(day, new Date());
                return (
                  <div key={day.toISOString()} onClick={() => setSelectedDate(day)}
                    className={`min-h-16 sm:min-h-24 p-0.5 border rounded cursor-pointer hover:bg-blue-50 ${!isSameMonth(day, currentMonth) ? 'bg-gray-100' : 'bg-white'} ${isToday ? 'ring-2 ring-blue-500' : ''}`}>
                    <div className="text-right font-medium">{format(day, 'd')}</div>
                    {dayJobs.slice(0, 1).map(j => <div key={j.id} className={`px-0.5 rounded truncate mt-0.5 ${j.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>{j.title}</div>)}
                    {dayJobs.length > 1 && <div className="text-gray-500">+{dayJobs.length-1}</div>}
                  </div>
                );
              })}
            </div>
            {selectedDate && (
              <div className="mt-4">
                <h3 className="font-medium mb-2 text-sm">Jobs on {format(selectedDate, 'PPP')}</h3>
                {jobsOnDate(selectedDate).map(job => (
                  <JobCard key={job.id} job={job} showCompletedCheck onToggleComplete={(done: boolean) => setJobCompleted(job.id, done)} onEdit={() => { setEditingJob(job); setShowJobModal(true); }} onDelete={() => deleteJob(job.id)} />
                ))}
                {jobsOnDate(selectedDate).length === 0 && <p className="text-gray-500 text-sm">Nothing scheduled this day.</p>}
              </div>
            )}
          </div>
        )}

        {activeTab === 'unscheduled' && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Unscheduled Jobs</h2>
            {jobs.filter(j => j.status === 'unscheduled').map(job => (
              <JobCard key={job.id} job={job} onEdit={() => { setEditingJob(job); setShowJobModal(true); }} onDelete={() => deleteJob(job.id)} onToggleComplete={(done: boolean) => setJobCompleted(job.id, done)} />
            ))}
            {jobs.filter(j => j.status === 'unscheduled').length === 0 && <p className="text-gray-500">None yet. Use + Job on this tab. Leave the date blank.</p>}
          </div>
        )}

        {activeTab === 'completed' && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Completed Jobs</h2>
            {jobs.filter(j => j.status === 'completed').map(job => (
              <JobCard key={job.id} job={job} onEdit={() => { setEditingJob(job); setShowJobModal(true); }} onDelete={() => deleteJob(job.id)} />
            ))}
            {jobs.filter(j => j.status === 'completed').length === 0 && <p className="text-gray-500">None yet</p>}
          </div>
        )}

        {activeTab === 'todos' && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-semibold">Task List</h2>
              <QuickAdd onAdd={addTodo} placeholder="New task..." />
            </div>
            {todos.map(todo => (
              <div key={todo.id} className="flex items-center gap-3 bg-white p-3 rounded-lg border mb-2">
                <input type="checkbox" checked={todo.completed} onChange={() => toggleTodo(todo.id, todo.completed)} className="w-5 h-5" />
                <span className={`flex-1 ${todo.completed ? 'line-through text-gray-400' : ''}`}>{todo.title}</span>
                <button onClick={() => deleteTodo(todo.id)} className="text-red-500 text-sm">Delete</button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'customers' && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Customers</h2>
            <input
              value={customerQuery}
              onChange={e => setCustomerQuery(e.target.value)}
              placeholder="Search customers"
              className="w-full border rounded px-3 py-2 mb-3"
            />
            {customers.filter(customer => customer.name.toLowerCase().includes(customerQuery.trim().toLowerCase())).map(customer => {
              const key = customer.name.toLowerCase();
              const open = openCustomer === key;
              return (
                <div key={key} className="bg-white rounded-lg border mb-2">
                  <button type="button" onClick={() => setOpenCustomer(open ? null : key)} className="w-full text-left px-3 py-3 font-medium">
                    {customer.name}
                  </button>
                  {open && (
                    <div className="px-3 pb-3 text-sm text-gray-700 space-y-1">
                      <p>Phone: {customer.phone || 'None'}</p>
                      <p>Email: {customer.email || 'None'}</p>
                      <p>Address: {customer.address || 'None'}</p>
                      <ContactActions phone={customer.phone} address={customer.address} />
                      <h4 className="font-medium pt-2">Jobs</h4>
                      {jobs.filter(job => (job.customer_name || '').trim().toLowerCase() === key).length === 0 && <p className="text-gray-500">No jobs yet.</p>}
                      {jobs.filter(job => (job.customer_name || '').trim().toLowerCase() === key).map(job => (
                        <button
                          type="button"
                          key={job.id}
                          onClick={() => { setEditingJob(job); setShowJobModal(true); }}
                          className="block w-full text-left bg-gray-50 border rounded px-2 py-2 mb-1"
                        >
                          <div className="font-medium">{job.title}</div>
                          <div className="text-xs text-gray-500">{job.scheduled_date ? format(new Date(job.scheduled_date), 'PPp') : 'Unscheduled'} · {job.status}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {customers.filter(customer => customer.name.toLowerCase().includes(customerQuery.trim().toLowerCase())).length === 0 && (
              <p className="text-gray-500">{customers.length === 0 ? 'None yet. Save a job with a customer name and they will show up here.' : 'No customers match that search.'}</p>
            )}
          </div>
        )}

        {activeTab === 'estimator' && (
          <div className="bg-white p-4 sm:p-6 rounded-xl border max-w-md mx-auto">
            <h2 className="text-lg font-semibold mb-4">Estimator</h2>
            <div className="space-y-3">
              <input type="number" value={estHours} onChange={e => setEstHours(+e.target.value)} placeholder="Hours" className="w-full border rounded px-3 py-2" />
              <input type="number" value={estRate} onChange={e => setEstRate(+e.target.value)} placeholder="Rate $" className="w-full border rounded px-3 py-2" />
              <input type="number" value={estMaterials} onChange={e => setEstMaterials(+e.target.value)} placeholder="Materials $" className="w-full border rounded px-3 py-2" />
              <input type="number" value={estMarkup} onChange={e => setEstMarkup(+e.target.value)} placeholder="Markup %" className="w-full border rounded px-3 py-2" />
              <div className="pt-2 border-t font-bold">Total: ${totalEstimate.toFixed(2)}</div>
              <button onClick={() => { setEditingJob({ title: '', estimated_hours: estHours, hourly_rate: estRate, material_cost: estMaterials, markup_percent: estMarkup, status: 'unscheduled' } as any); setShowJobModal(true); }} className="w-full bg-blue-600 text-white py-2 rounded">Create Job from Estimate</button>
            </div>
          </div>
        )}
      </main>

      {showJobModal && <JobModal job={editingJob} customers={customers} onClose={() => { setShowJobModal(false); setEditingJob(null); }} onSave={saveJob} defaultDate={activeTab === 'calendar' ? selectedDate : null} />}
    </div>
  );
}

function AuthScreen({ onSignIn, onSignUp }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-6 rounded-xl border max-w-md w-full">
        <h1 className="text-2xl font-bold mb-6 text-center">Job Manager</h1>
        <form onSubmit={e => { e.preventDefault(); isSignUp ? onSignUp(email, password) : onSignIn(email, password); }} className="space-y-4">
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full border rounded px-3 py-2" />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full border rounded px-3 py-2" />
          <button className="w-full bg-blue-600 text-white py-2 rounded">{isSignUp ? 'Sign Up' : 'Sign In'}</button>
        </form>
        <button onClick={() => setIsSignUp(!isSignUp)} className="w-full mt-4 text-sm text-blue-600">{isSignUp ? 'Sign in instead' : 'Create account'}</button>
      </div>
    </div>
  );
}

function QuickAdd({ onAdd, placeholder }: any) {
  const [value, setValue] = useState('');
  return (
    <form onSubmit={e => { e.preventDefault(); if (value.trim()) { onAdd(value.trim()); setValue(''); } }} className="flex gap-2">
      <input value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder} className="border rounded px-3 py-1.5 text-sm flex-1" />
      <button className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm">Add</button>
    </form>
  );
}

function photoSrc(stored: string) {
  if (!stored) return '';
  if (stored.startsWith('b64:')) return `data:image/jpeg;base64,${stored.slice(4)}`;
  return stored;
}

function PhotoGallery({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const list = (urls || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <>
      <div className="flex gap-2 mt-2 overflow-x-auto">
        {list.map((url, i) => (
          <button type="button" key={i} onClick={() => setOpen(i)} className="shrink-0">
            <img src={photoSrc(url)} alt="Job photo" className="h-20 w-20 object-cover rounded border" />
          </button>
        ))}
      </div>
      {open !== null && (
        <div className="fixed inset-0 z-[80] bg-black flex flex-col" onClick={() => setOpen(null)}>
          <div className="flex justify-between items-center text-white p-3">
            <button type="button" className="px-3 py-2 text-base" onClick={e => { e.stopPropagation(); setOpen(open > 0 ? open - 1 : list.length - 1); }}>Prev</button>
            <button type="button" className="px-3 py-2 text-base">Close</button>
            <button type="button" className="px-3 py-2 text-base" onClick={e => { e.stopPropagation(); setOpen(open < list.length - 1 ? open + 1 : 0); }}>Next</button>
          </div>
          <img src={photoSrc(list[open])} alt="Job photo" className="flex-1 min-h-0 w-full object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

function JobCard({ job, onEdit, onDelete, onToggleComplete, showCompletedCheck }: any) {
  return (
    <div className="bg-white p-3 sm:p-4 rounded-lg border mb-3">
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{job.title}</h3>
          {job.customer_name && <p className="text-sm text-gray-600">{job.customer_name}</p>}
          <ContactActions phone={job.customer_phone} address={job.address} />
          {job.scheduled_date && <p className="text-sm text-blue-600">{format(new Date(job.scheduled_date), 'PPp')}</p>}
          {readNotes(job.notes) && <p className="text-sm text-gray-700 mt-1 line-clamp-2">{readNotes(job.notes)}</p>}
          {job.total_estimate && <p className="text-sm text-green-700">Est: ${Number(job.total_estimate).toFixed(2)}</p>}
          {job.photos && job.photos.length > 0 && <PhotoGallery urls={job.photos} />}
          {showCompletedCheck && (
            <label className="flex items-center gap-2 mt-3 text-sm font-medium">
              <input type="checkbox" className="w-5 h-5" checked={job.status === 'completed'} onChange={() => onToggleComplete(job.status !== 'completed')} />
              Completed
            </label>
          )}
        </div>
        <div className="flex flex-col gap-1 text-sm flex-shrink-0">
          <button onClick={onEdit} className="text-blue-600">Edit</button>
          {!showCompletedCheck && onToggleComplete && job.status !== 'completed' && <button onClick={() => onToggleComplete(true)} className="text-green-600">Done</button>}
          <button onClick={onDelete} className="text-red-500">Delete</button>
        </div>
      </div>
    </div>
  );
}

function JobModal({ job, customers, onClose, onSave, defaultDate }: any) {
  const [form, setForm] = useState({
    title: job?.title || '',
    description: job?.description || '',
    status: job?.status || 'unscheduled',
    scheduled_date: job?.scheduled_date ? toLocalInput(job.scheduled_date) : (defaultDate ? format(defaultDate, "yyyy-MM-dd'T'HH:mm") : ''),
    customer_name: job?.customer_name || '',
    customer_phone: job?.customer_phone || '',
    customer_email: readEmail(job?.notes),
    address: job?.address || '',
    notes: readNotes(job?.notes),
    estimated_hours: job?.estimated_hours || '',
    hourly_rate: job?.hourly_rate || '',
    material_cost: job?.material_cost || '',
    markup_percent: job?.markup_percent || 20,
  });
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const nameQuery = form.customer_name.trim().toLowerCase();
  const nameMatches = nameQuery
    ? (customers || []).filter((customer: Customer) => customer.name.toLowerCase().includes(nameQuery)).slice(0, 8)
    : [];

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const data: any = {
      title: form.title,
      description: form.description || null,
      status: form.status,
      customer_name: form.customer_name || null,
      customer_phone: form.customer_phone || null,
      address: form.address || null,
      notes: packNotes(form.customer_email, form.notes),
      estimated_hours: form.estimated_hours ? +form.estimated_hours : null,
      hourly_rate: form.hourly_rate ? +form.hourly_rate : null,
      material_cost: form.material_cost ? +form.material_cost : null,
      markup_percent: +form.markup_percent || 20,
    };
    if (form.scheduled_date) {
      data.scheduled_date = new Date(form.scheduled_date).toISOString();
      if (data.status !== 'completed') data.status = 'scheduled';
    } else {
      data.scheduled_date = null;
      if (data.status !== 'completed') data.status = 'unscheduled';
    }
    onSave(data, newPhotos).finally(() => setSaving(false));
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
      <div className="bg-white rounded-t-xl sm:rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <h2 className="text-xl font-semibold mb-4">{job?.id ? 'Edit Job' : 'New Job'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input required placeholder="Job title *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full border rounded px-3 py-2" />
          <textarea placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full border rounded px-3 py-2" rows={2} />
          <div className="relative">
            <input
              placeholder="Customer name"
              value={form.customer_name}
              autoComplete="off"
              onFocus={() => setNameOpen(true)}
              onBlur={() => setTimeout(() => setNameOpen(false), 150)}
              onChange={e => { setForm({...form, customer_name: e.target.value}); setNameOpen(true); }}
              className="w-full border rounded px-3 py-2"
            />
            {nameOpen && nameMatches.length > 0 && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded shadow max-h-48 overflow-y-auto">
                {nameMatches.map((customer: Customer) => (
                  <button
                    type="button"
                    key={customer.name.toLowerCase()}
                    className="block w-full text-left px-3 py-2 hover:bg-blue-50"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      setForm({
                        ...form,
                        customer_name: customer.name,
                        customer_phone: customer.phone || '',
                        customer_email: customer.email || '',
                        address: customer.address || '',
                      });
                      setNameOpen(false);
                    }}
                  >
                    <div className="font-medium">{customer.name}</div>
                    {(customer.phone || customer.email || customer.address) && (
                      <div className="text-xs text-gray-500 truncate">{[customer.phone, customer.email, customer.address].filter(Boolean).join(' · ')}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input placeholder="Phone" value={form.customer_phone} onChange={e => setForm({...form, customer_phone: e.target.value})} className="w-full border rounded px-3 py-2" />
          <input type="email" placeholder="Email" value={form.customer_email} onChange={e => setForm({...form, customer_email: e.target.value})} className="w-full border rounded px-3 py-2" />
          <input placeholder="Address" value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="w-full border rounded px-3 py-2" />
          <input type="datetime-local" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} className="w-full border rounded px-3 py-2" />
          <p className="text-xs text-gray-500 -mt-2">Leave the date blank for Unscheduled. A date puts it on the calendar only.</p>
          <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full border rounded px-3 py-2" rows={3} />
          <div>
            <label className="text-sm text-gray-600">Photos</label>
            <input type="file" accept="image/*" multiple onChange={e => setNewPhotos(Array.from(e.target.files || []))} className="w-full text-sm mt-1" />
            {job?.photos && job.photos.length > 0 && <PhotoGallery urls={job.photos} />}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" placeholder="Hours" value={form.estimated_hours} onChange={e => setForm({...form, estimated_hours: e.target.value})} className="border rounded px-3 py-2" />
            <input type="number" placeholder="Rate" value={form.hourly_rate} onChange={e => setForm({...form, hourly_rate: e.target.value})} className="border rounded px-3 py-2" />
            <input type="number" placeholder="Materials" value={form.material_cost} onChange={e => setForm({...form, material_cost: e.target.value})} className="border rounded px-3 py-2" />
            <input type="number" placeholder="Markup %" value={form.markup_percent} onChange={e => setForm({...form, markup_percent: e.target.value})} className="border rounded px-3 py-2" />
          </div>
          <div className="flex gap-2 pt-2 sticky bottom-0 bg-white">
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded disabled:opacity-60">{saving ? 'Saving...' : 'Save'}</button>
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
