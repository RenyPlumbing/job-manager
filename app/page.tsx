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

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'calendar' | 'unscheduled' | 'completed' | 'todos' | 'estimator'>('calendar');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
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
    setJobs(jobsData || []);
    setTodos(todosData || []);
    setLoading(false);
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
    let photoUrls = editingJob?.photos || [];

    if (newPhotos.length > 0) {
      for (const file of newPhotos) {
        const fileName = `${Date.now()}-${file.name}`;
        const { data, error } = await supabase.storage.from('job-photos').upload(fileName, file);
        if (!error && data) {
          const { data: urlData } = supabase.storage.from('job-photos').getPublicUrl(data.path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }
    jobData.photos = photoUrls;

    if (jobId) {
      const { error } = await supabase.from('jobs').update(jobData).eq('id', jobId);
      if (error) { alert(error.message); return; }
    } else {
      const { error } = await supabase.from('jobs').insert(jobData);
      if (error) { alert(error.message); return; }
    }
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
        {(['calendar', 'unscheduled', 'completed', 'todos', 'estimator'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-3 py-3 text-sm font-medium capitalize whitespace-nowrap flex-shrink-0 ${activeTab === tab ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}>
            {tab}
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
                  <CalendarJob key={job.id} job={job} onToggle={() => setJobCompleted(job.id, job.status !== 'completed')} onEdit={() => { setEditingJob(job); setShowJobModal(true); }} onDelete={() => deleteJob(job.id)} />
                ))}
                {jobsOnDate(selectedDate).length === 0 && <p className="text-gray-500 text-sm">Nothing scheduled this day. Tap the day the job is on.</p>}
              </div>
            )}
            <div className="mt-6">
              <h3 className="font-medium mb-2 text-sm">Every job on this month</h3>
              {jobs.filter(j => j.scheduled_date && (j.status === 'scheduled' || j.status === 'completed') && isSameMonth(new Date(j.scheduled_date), currentMonth)).map(job => (
                <CalendarJob key={job.id} job={job} onToggle={() => setJobCompleted(job.id, job.status !== 'completed')} onEdit={() => { setEditingJob(job); setShowJobModal(true); }} onDelete={() => deleteJob(job.id)} />
              ))}
            </div>
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
              <h2 className="text-lg font-semibold">To-Do List</h2>
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

      {showJobModal && <JobModal job={editingJob} onClose={() => { setShowJobModal(false); setEditingJob(null); }} onSave={saveJob} defaultDate={activeTab === 'calendar' ? selectedDate : null} />}
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

function CalendarJob({ job, onToggle, onEdit, onDelete }: any) {
  return (
    <div className="bg-white p-3 rounded-lg border mb-3">
      <label className="flex items-center gap-3 text-base font-medium">
        <input type="checkbox" className="w-7 h-7" checked={job.status === 'completed'} onChange={onToggle} />
        Completed
      </label>
      <div className="mt-2">
        <JobCard job={job} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

function JobCard({ job, onEdit, onDelete, onToggleComplete, showCompletedCheck }: any) {
  return (
    <div className="bg-white p-3 sm:p-4 rounded-lg border mb-3">
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium truncate">{job.title}</h3>
          {job.customer_name && <p className="text-sm text-gray-600">{job.customer_name}</p>}
          {job.scheduled_date && <p className="text-sm text-blue-600">{format(new Date(job.scheduled_date), 'PPp')}</p>}
          {job.notes && <p className="text-sm text-gray-700 mt-1 line-clamp-2">{job.notes}</p>}
          {job.total_estimate && <p className="text-sm text-green-700">Est: ${Number(job.total_estimate).toFixed(2)}</p>}
          {job.photos && job.photos.length > 0 && (
            <div className="flex gap-1 mt-2 overflow-x-auto">
              {job.photos.slice(0, 3).map((url: string, i: number) => (
                <img key={i} src={url} alt="" className="h-12 w-12 object-cover rounded" />
              ))}
              {job.photos.length > 3 && <span className="text-xs text-gray-500 self-center">+{job.photos.length - 3}</span>}
            </div>
          )}
          {showCompletedCheck && (
            <label className="flex items-center gap-2 mt-3 text-sm">
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

function JobModal({ job, onClose, onSave, defaultDate }: any) {
  const [form, setForm] = useState({
    title: job?.title || '',
    description: job?.description || '',
    status: job?.status || 'unscheduled',
    scheduled_date: job?.scheduled_date ? toLocalInput(job.scheduled_date) : (defaultDate ? format(defaultDate, "yyyy-MM-dd'T'HH:mm") : ''),
    customer_name: job?.customer_name || '',
    customer_phone: job?.customer_phone || '',
    address: job?.address || '',
    notes: job?.notes || '',
    estimated_hours: job?.estimated_hours || '',
    hourly_rate: job?.hourly_rate || '',
    material_cost: job?.material_cost || '',
    markup_percent: job?.markup_percent || 20,
  });
  const [newPhotos, setNewPhotos] = useState<File[]>([]);

  const handleSubmit = (e: any) => {
    e.preventDefault();
    const data: any = {
      title: form.title,
      description: form.description || null,
      status: form.status,
      customer_name: form.customer_name || null,
      customer_phone: form.customer_phone || null,
      address: form.address || null,
      notes: form.notes || null,
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
    onSave(data, newPhotos);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
      <div className="bg-white rounded-t-xl sm:rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <h2 className="text-xl font-semibold mb-4">{job?.id ? 'Edit Job' : 'New Job'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input required placeholder="Job title *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full border rounded px-3 py-2" />
          <textarea placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full border rounded px-3 py-2" rows={2} />
          <input placeholder="Customer name" value={form.customer_name} onChange={e => setForm({...form, customer_name: e.target.value})} className="w-full border rounded px-3 py-2" />
          <input placeholder="Phone" value={form.customer_phone} onChange={e => setForm({...form, customer_phone: e.target.value})} className="w-full border rounded px-3 py-2" />
          <input placeholder="Address" value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="w-full border rounded px-3 py-2" />
          <input type="datetime-local" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} className="w-full border rounded px-3 py-2" />
          <p className="text-xs text-gray-500 -mt-2">Leave the date blank for Unscheduled. A date puts it on the calendar only.</p>
          <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full border rounded px-3 py-2" rows={3} />
          <div>
            <label className="text-sm text-gray-600">Photos</label>
            <input type="file" accept="image/*" multiple onChange={e => setNewPhotos(Array.from(e.target.files || []))} className="w-full text-sm mt-1" />
            {job?.photos && job.photos.length > 0 && (
              <div className="flex gap-1 mt-2 overflow-x-auto">
                {job.photos.map((url: string, i: number) => <img key={i} src={url} alt="" className="h-16 w-16 object-cover rounded" />)}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" placeholder="Hours" value={form.estimated_hours} onChange={e => setForm({...form, estimated_hours: e.target.value})} className="border rounded px-3 py-2" />
            <input type="number" placeholder="Rate" value={form.hourly_rate} onChange={e => setForm({...form, hourly_rate: e.target.value})} className="border rounded px-3 py-2" />
            <input type="number" placeholder="Materials" value={form.material_cost} onChange={e => setForm({...form, material_cost: e.target.value})} className="border rounded px-3 py-2" />
            <input type="number" placeholder="Markup %" value={form.markup_percent} onChange={e => setForm({...form, markup_percent: e.target.value})} className="border rounded px-3 py-2" />
          </div>
          <div className="flex gap-2 pt-2 sticky bottom-0 bg-white">
            <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded">Save</button>
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
