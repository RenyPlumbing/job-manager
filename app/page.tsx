'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, eachDayOfInterval, isSameDay, isSameMonth, differenceInCalendarDays, addMonths, subMonths, addDays, subDays, addWeeks, subWeeks } from 'date-fns';

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
  created_at?: string;
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
  const match = (notes || '').match(/@@email:(.*?)@@/);
  return match ? match[1] : '';
}

function readInvoice(notes?: string) {
  const match = (notes || '').match(/@@invoice:(needs|sent|paid)@@/);
  return match ? match[1] : '';
}

function readEstimate(notes?: string) {
  const match = (notes || '').match(/@@estimate:(open|needs|sent|approved)@@/);
  return match ? match[1] : '';
}

function readExtraDates(notes?: string) {
  const match = (notes || '').match(/@@dates:(.*?)@@/);
  if (!match || !match[1]) return [] as string[];
  return match[1].split('|').map(item => item.trim()).filter(Boolean);
}

function readUntil(notes?: string) {
  const match = (notes || '').match(/@@until:(\d{2}:\d{2})@@/);
  return match ? match[1] : '';
}

function readAllDay(notes?: string) {
  return /@@allday@@/.test(notes || '');
}

function readNotes(notes?: string) {
  return (notes || '')
    .replace(/@@invoice:(needs|sent|paid)@@\n?/g, '')
    .replace(/@@estimate:(open|needs|sent|approved)@@\n?/g, '')
    .replace(/@@email:.*?@@\n?/g, '')
    .replace(/@@dates:.*?@@\n?/g, '')
    .replace(/@@until:\d{2}:\d{2}@@\n?/g, '')
    .replace(/@@allday@@\n?/g, '');
}

function invoiceKey(job?: { status?: string; notes?: string }) {
  if (job?.status !== 'completed') return '';
  return readInvoice(job.notes) || 'needs';
}

function invoiceColor(key: string) {
  if (key === 'needs') return { card: 'bg-orange-200 border-orange-500', chip: 'bg-orange-600 text-white', block: 'bg-orange-600 text-white', on: 'bg-orange-600 text-white border-orange-600' };
  if (key === 'sent') return { card: 'bg-yellow-100 border-yellow-400', chip: 'bg-yellow-300 text-yellow-950', block: 'bg-yellow-300 text-yellow-950', on: 'bg-yellow-300 text-yellow-950 border-yellow-400' };
  if (key === 'paid') return { card: 'bg-green-100 border-green-400', chip: 'bg-green-600 text-white', block: 'bg-green-600 text-white', on: 'bg-green-600 text-white border-green-600' };
  return { card: 'bg-white border-gray-200', chip: 'bg-blue-100 text-blue-800', block: 'bg-indigo-500 text-white', on: '' };
}

function estimateColor(key: string) {
  if (key === 'needs') return { card: 'bg-sky-100 border-sky-500', chip: 'bg-sky-600 text-white', block: 'bg-sky-600 text-white', on: 'bg-sky-600 text-white border-sky-600' };
  if (key === 'sent') return { card: 'bg-purple-100 border-purple-500', chip: 'bg-purple-600 text-white', block: 'bg-purple-600 text-white', on: 'bg-purple-600 text-white border-purple-600' };
  if (key === 'approved') return { card: 'bg-teal-100 border-teal-500', chip: 'bg-teal-600 text-white', block: 'bg-teal-600 text-white', on: 'bg-teal-600 text-white border-teal-600' };
  return { card: 'bg-white border-gray-200', chip: 'bg-blue-100 text-blue-800', block: 'bg-indigo-500 text-white', on: '' };
}

function isEstimateJob(job?: { status?: string; notes?: string }) {
  return job?.status === 'estimate' || !!readEstimate(job?.notes);
}

function estimateStage(notes?: string) {
  const key = readEstimate(notes);
  return key === 'needs' || key === 'sent' || key === 'approved' ? key : '';
}

function jobColor(job?: { status?: string; notes?: string }) {
  const stage = estimateStage(job?.notes);
  if (stage) return estimateColor(stage);
  return invoiceColor(invoiceKey(job));
}

function packNotes(email: string, notes: string, invoice = '', extraDates?: string[], until?: string | null, allDay?: boolean | null, estimate?: string | null) {
  const dates = (extraDates ?? readExtraDates(notes)).filter(Boolean);
  const end = until == null ? readUntil(notes) : until;
  const dayFlag = allDay == null ? readAllDay(notes) : allDay;
  const est = estimate == null ? readEstimate(notes) : estimate;
  const clean = readNotes(notes).trim();
  const estTag = est === 'open' || est === 'needs' || est === 'sent' || est === 'approved' ? `@@estimate:${est}@@` : '';
  const inv = !estTag && (invoice === 'needs' || invoice === 'sent' || invoice === 'paid') ? `@@invoice:${invoice}@@\n` : '';
  const mail = email.trim() ? `@@email:${email.trim()}@@` : '';
  const dateTag = dates.length ? `@@dates:${dates.join('|')}@@` : '';
  const untilTag = end ? `@@until:${end}@@` : '';
  const allDayTag = dayFlag && !end ? '@@allday@@' : '';
  const head = `${inv}${[estTag, mail, dateTag, untilTag, allDayTag].filter(Boolean).join('\n')}`.trim();
  const body = `${head}${head && clean ? '\n' : ''}${clean}`.trim();
  return body || null;
}

function formatJobSchedule(job: { scheduled_date?: string; notes?: string }) {
  const dates = [job.scheduled_date, ...readExtraDates(job.notes)].filter((value): value is string => !!value);
  return dates.map((value, index) => {
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return '';
    if (index === 0 && readUntil(job.notes)) {
      const [hours, minutes] = readUntil(job.notes).split(':').map(Number);
      const end = new Date(start);
      end.setHours(hours || 0, minutes || 0, 0, 0);
      return `${format(start, 'PPP')}, ${format(start, 'p')} – ${format(end, 'p')}`;
    }
    if (index === 0 && readAllDay(job.notes)) return format(start, 'PPP');
    return format(start, 'PPp');
  }).filter(Boolean).join(' · ');
}

function ContactActions({ phone, address }: { phone?: string; address?: string }) {
  const tel = (phone || '').replace(/[^\d+]/g, '');
  if (!tel && !address) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {tel && <a href={`tel:${tel}`} className="px-3 py-1.5 rounded border text-sm">Call</a>}
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

const USER_MARK = '@@user:';

function userRecord(title?: string) {
  if (!title?.startsWith(USER_MARK)) return null;
  const rest = title.slice(USER_MARK.length);
  const bar = rest.indexOf('|');
  if (bar === -1) return { email: rest, nickname: '' };
  return { email: rest.slice(0, bar), nickname: rest.slice(bar + 1) };
}

function userTitle(email: string, nickname: string) {
  return `${USER_MARK}${email}|${nickname.trim()}`;
}

const TASK_MARK = '@@task:';

function packTask(text: string, creator: string, assignee: string, photos: string[] = [], audio = '') {
  const clean = photos.map(photo => photo.replace(/^b64:/, '')).filter(Boolean);
  const photoPart = clean.length ? `@@photos:${clean.join('|')}` : '';
  const audioPart = audio ? `@@audio:${audio}` : '';
  return `${TASK_MARK}${creator}|${assignee}@@${text.trim()}${photoPart}${audioPart}`;
}

function unpackTask(title?: string) {
  const empty = { text: title || '', creator: '', assignee: '', photos: [] as string[], audio: '' };
  if (!title?.startsWith(TASK_MARK)) return empty;
  const rest = title.slice(TASK_MARK.length);
  const splitAt = rest.indexOf('@@');
  if (splitAt === -1) return { text: title, creator: '', assignee: '', photos: [] as string[], audio: '' };
  const meta = rest.slice(0, splitAt);
  let body = rest.slice(splitAt + 2);
  const audioAt = body.indexOf('@@audio:');
  let audio = '';
  if (audioAt !== -1) {
    audio = body.slice(audioAt + '@@audio:'.length);
    body = body.slice(0, audioAt);
  }
  let photos: string[] = [];
  const photoAt = body.indexOf('@@photos:');
  if (photoAt !== -1) {
    photos = body.slice(photoAt + '@@photos:'.length).split('|').filter(Boolean).map(photo => photo.startsWith('b64:') ? photo : `b64:${photo}`);
    body = body.slice(0, photoAt);
  }
  const bar = meta.indexOf('|');
  return {
    text: body,
    creator: bar === -1 ? meta : meta.slice(0, bar),
    assignee: bar === -1 ? '' : meta.slice(bar + 1),
    photos,
    audio,
  };
}

function taskNoticeBody(task: { text: string; photos: string[]; audio: string }) {
  if (task.text.trim()) return task.text.trim();
  if (task.photos.length) return 'Photo task';
  if (task.audio) return 'Voice recording';
  return 'New task';
}

const VAPID_PUBLIC_KEY = 'BEvR_HuocfRtsz6jNlAzm_W7NKng7XmUiNYp2c1s8GR9YD8t4mxH3FPm3FWwaDxrcz4ef3PZWBJNaI5pTFjM6Rw';

function pushRecord(title?: string) {
  if (!title?.startsWith('@@push:')) return null;
  const rest = title.slice('@@push:'.length);
  const splitAt = rest.indexOf('@@');
  if (splitAt === -1) return null;
  try {
    return { email: rest.slice(0, splitAt), subscription: JSON.parse(rest.slice(splitAt + 2)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
  } catch {
    return null;
  }
}

function vapidKeyBytes() {
  const padded = VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (VAPID_PUBLIC_KEY.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function notifyAssignedTasks(allTodos: Todo[], email: string, setAlerts: (items: string[]) => void) {
  const storageKey = 'reny-task-notices';
  const seen: string[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
  const seeded = localStorage.getItem('reny-task-notices-seeded') === '1';
  const next = new Set(seen);
  const fresh: { body: string; id: string }[] = [];
  for (const todo of allTodos) {
    if (userRecord(todo.title) || pushRecord(todo.title) || todo.completed) continue;
    const task = unpackTask(todo.title);
    if (!task.assignee || task.assignee !== email) continue;
    const key = `${todo.id}|${task.assignee}`;
    if (next.has(key)) continue;
    next.add(key);
    const recent = !!todo.created_at && Date.now() - new Date(todo.created_at).getTime() < 2 * 60 * 1000;
    if (seeded || recent) fresh.push({ body: taskNoticeBody(task), id: String(todo.id) });
  }
  localStorage.setItem(storageKey, JSON.stringify(Array.from(next).slice(-300)));
  if (!seeded) localStorage.setItem('reny-task-notices-seeded', '1');
  if (!fresh.length) return;
  setAlerts(fresh.map(item => item.body));
  if (localStorage.getItem('reny-task-notify') !== '1' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  for (const item of fresh) {
    try { await showTaskNotification(item.body, `reny-${item.id}`); } catch { /* alerts blocked */ }
  }
}

async function showTaskNotification(body: string, tag = 'reny-task') {
  const title = 'Task assigned to you';
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) await reg.showNotification(title, { body, icon: '/icon-192.png', badge: '/notification-icon.png', tag });
  else new Notification(title, { body, icon: '/icon-192.png', tag });
}

async function filesToPhotos(files: File[]) {
  const photos: string[] = [];
  const failed: string[] = [];
  for (const file of files) {
    try {
      const blob = await compressImage(file);
      const dataUrl = await blobToDataUrl(blob);
      const base64 = dataUrl.split(',')[1];
      if (!base64) throw new Error('empty');
      photos.push(base64);
    } catch {
      failed.push(file.name || 'photo');
    }
  }
  return { photos, failed };
}

function audioSrc(stored: string) {
  if (stored.startsWith('webm:')) return `data:audio/webm;base64,${stored.slice(5)}`;
  if (stored.startsWith('mp4:')) return `data:audio/mp4;base64,${stored.slice(4)}`;
  return '';
}

let stopActiveVoice: (() => void) | null = null;

function VoiceNote({ audio, onChange }: { audio: string; onChange?: (next: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const chunks = useRef<Blob[]>([]);
  const player = useRef<HTMLAudioElement | null>(null);

  function stopPlayback() {
    player.current?.pause();
    if (player.current) player.current.currentTime = 0;
    player.current = null;
    if (stopActiveVoice === stopPlayback) stopActiveVoice = null;
    setPlaying(false);
  }

  function play() {
    if (playing) {
      stopPlayback();
      return;
    }
    stopActiveVoice?.();
    const next = new Audio(audioSrc(audio));
    player.current = next;
    stopActiveVoice = stopPlayback;
    next.onended = () => stopPlayback();
    setPlaying(true);
    next.play();
  }

  function stop() {
    recorder.current?.stop();
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
  }

  async function start() {
    stopPlayback();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('This phone cannot record audio here.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
      chunks.current = [];
      rec.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        const dataUrl = await blobToDataUrl(blob);
        const base64 = dataUrl.split(',')[1];
        if (base64) onChange?.(`${(rec.mimeType || '').includes('mp4') ? 'mp4' : 'webm'}:${base64}`);
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
      setSeconds(0);
      timer.current = window.setInterval(() => {
        setSeconds(current => {
          if (current >= 119) stop();
          return current + 1;
        });
      }, 1000);
    } catch {
      alert('Allow the microphone to record a voice note.');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onChange && !recording && <button type="button" onClick={start} className="px-3 py-1.5 rounded bg-red-600 text-white text-sm">Record</button>}
      {recording && <button type="button" onClick={stop} className="px-3 py-1.5 rounded bg-gray-800 text-white text-sm">Stop {seconds}s</button>}
      {audio && (
        <button type="button" onClick={play} className={`px-3 py-1.5 rounded text-sm ${playing ? 'bg-blue-600 text-white' : 'border'}`}>
          {playing ? 'Playing' : 'Play'}
        </button>
      )}
      {audio && onChange && <button type="button" onClick={() => { stopPlayback(); onChange(''); }} className="text-sm text-red-500">Remove</button>}
    </div>
  );
}

const WEEK_START_HOUR = 6;
const WEEK_END_HOUR = 20;
const HOUR_HEIGHT = 52;

function placeDayJobs(dayJobs: Job[], day: Date) {
  const windowStart = WEEK_START_HOUR * 60;
  const windowEnd = WEEK_END_HOUR * 60;
  const items = dayJobs.map(job => {
    const dates = [job.scheduled_date, ...readExtraDates(job.notes)].filter((value): value is string => !!value);
    const match = dates.find(value => isSameDay(new Date(value), day)) || job.scheduled_date || '';
    const start = new Date(match);
    const hours = Number(job.estimated_hours) > 0 ? Number(job.estimated_hours) : 1;
    let a = start.getHours() * 60 + start.getMinutes();
    let b = a + Math.round(hours * 60);
    const onPrimary = !!job.scheduled_date && isSameDay(new Date(job.scheduled_date), day);
    const until = onPrimary ? readUntil(job.notes) : '';
    if (until) {
      const [hoursUntil, minutesUntil] = until.split(':').map(Number);
      b = (hoursUntil || 0) * 60 + (minutesUntil || 0);
    }
    a = Math.max(windowStart, Math.min(a, windowEnd - 28));
    b = Math.max(a + 28, Math.min(b, windowEnd));
    return { job, a, b, col: 0, cols: 1 };
  }).sort((x, y) => x.a - y.a || y.b - x.b);
  const clusters: typeof items[] = [];
  for (const item of items) {
    const cluster = clusters.find(group => group.some(other => other.a < item.b && item.a < other.b));
    if (cluster) cluster.push(item);
    else clusters.push([item]);
  }
  for (const cluster of clusters) {
    const ends: number[] = [];
    for (const item of cluster) {
      let col = ends.findIndex(end => end <= item.a);
      if (col === -1) {
        col = ends.length;
        ends.push(item.b);
      } else ends[col] = item.b;
      item.col = col;
    }
    const cols = Math.max(1, ...cluster.map(item => item.col + 1));
    cluster.forEach(item => { item.cols = cols; });
  }
  return items;
}

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'calendar' | 'unscheduled' | 'estimates' | 'completed' | 'todos' | 'customers' | 'users' | 'estimator'>('calendar');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [users, setUsers] = useState<{ email: string; nickname: string }[]>([]);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [newTaskPhotos, setNewTaskPhotos] = useState<File[]>([]);
  const [editTaskPhotos, setEditTaskPhotos] = useState<File[]>([]);
  const [newTaskAudio, setNewTaskAudio] = useState('');
  const [editTaskAudio, setEditTaskAudio] = useState('');
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [nicknameLoaded, setNicknameLoaded] = useState(false);
  const [savedCustomers, setSavedCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);
  const [invoiceFilter, setInvoiceFilter] = useState<'all' | 'needs' | 'sent' | 'paid'>('all');
  const [estimateFilter, setEstimateFilter] = useState<'all' | 'needs' | 'sent' | 'approved'>('all');
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day' | 'tiles'>('month');
  const [showJobModal, setShowJobModal] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [viewingJob, setViewingJob] = useState<Job | null>(null);
  const [estHours, setEstHours] = useState(2);
  const [estRate, setEstRate] = useState(75);
  const [estMaterials, setEstMaterials] = useState(50);
  const [estMarkup, setEstMarkup] = useState(20);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [taskAlerts, setTaskAlerts] = useState<string[]>([]);
  const [pushSubs, setPushSubs] = useState<{ email: string; subscription: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }[]>([]);
  const [notifyOn, setNotifyOn] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('reny-dark') === '1';
    setDarkMode(saved);
    document.documentElement.classList.toggle('dark', saved);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    setNotifyOn(localStorage.getItem('reny-task-notify') === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted');
    if (!document.getElementById('reny-dark-style')) {
      const style = document.createElement('style');
      style.id = 'reny-dark-style';
      style.textContent = `
        html.dark, html.dark body { background:#0f172a !important; color:#e5e7eb !important; }
        html.dark .min-h-screen, html.dark .bg-gray-50 { background-color:#0f172a !important; }
        html.dark .bg-white { background-color:#1e293b !important; }
        html.dark .bg-gray-100 { background-color:#334155 !important; }
        html.dark .text-gray-900, html.dark .text-gray-800, html.dark .text-gray-700 { color:#e5e7eb !important; }
        html.dark .text-gray-600, html.dark .text-gray-500, html.dark .text-gray-400 { color:#cbd5e1 !important; }
        html.dark .border, html.dark .border-b, html.dark .border-t, html.dark .border-l { border-color:#334155 !important; }
        html.dark input, html.dark textarea, html.dark select { background:#0f172a !important; color:#f8fafc !important; border-color:#475569 !important; }
        html.dark .bg-blue-50 { background-color:#1e3a5f !important; }
        html.dark .job-card, html.dark .job-card h3, html.dark .job-card p { color:#ffffff !important; }
        html.dark .job-card.bg-orange-200, html.dark .job-card.bg-orange-200 h3, html.dark .job-card.bg-orange-200 p,
        html.dark .job-card.bg-yellow-100, html.dark .job-card.bg-yellow-100 h3, html.dark .job-card.bg-yellow-100 p,
        html.dark .job-card.bg-green-100, html.dark .job-card.bg-green-100 h3, html.dark .job-card.bg-green-100 p,
        html.dark .job-card.bg-sky-100, html.dark .job-card.bg-sky-100 h3, html.dark .job-card.bg-sky-100 p,
        html.dark .job-card.bg-purple-100, html.dark .job-card.bg-purple-100 h3, html.dark .job-card.bg-purple-100 p,
        html.dark .job-card.bg-teal-100, html.dark .job-card.bg-teal-100 h3, html.dark .job-card.bg-teal-100 p { color:#111827 !important; }
        html.dark button.job-tile, html.dark button.job-tile * { color:#f8fafc !important; }
        html.dark button.job-tile.bg-orange-200, html.dark button.job-tile.bg-orange-200 *,
        html.dark button.job-tile.bg-yellow-100, html.dark button.job-tile.bg-yellow-100 *,
        html.dark button.job-tile.bg-green-100, html.dark button.job-tile.bg-green-100 *,
        html.dark button.job-tile.bg-sky-100, html.dark button.job-tile.bg-sky-100 *,
        html.dark button.job-tile.bg-purple-100, html.dark button.job-tile.bg-purple-100 *,
        html.dark button.job-tile.bg-teal-100, html.dark button.job-tile.bg-teal-100 * { color:#111827 !important; }
      `;
      document.head.appendChild(style);
    }
  }, []);

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
    if (nicknameLoaded || !session?.user?.email) return;
    const mine = users.find(person => person.email === session.user.email);
    if (!mine) return;
    setNicknameDraft(mine.nickname || '');
    setNicknameLoaded(true);
  }, [users, session, nicknameLoaded]);

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

  useEffect(() => {
    const email = session?.user?.email;
    if (!email || localStorage.getItem('reny-task-notify') !== '1') return;
    savePushSubscription(email).catch(() => {});
  }, [session]);

  async function fetchData() {
    const { data: jobsData } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
    const { data: todosData } = await supabase.from('todos').select('*').order('created_at', { ascending: false });
    const { data: customerData } = await supabase.from('customers').select('name, phone, address').order('name');
    const allTodos = todosData || [];
    let people = allTodos.map(todo => userRecord(todo.title)).filter(Boolean) as { email: string; nickname: string }[];
    const email = session?.user?.email;
    if (email && !people.some(person => person.email === email)) {
      await supabase.from('todos').insert({ title: userTitle(email, '') });
      people = [...people, { email, nickname: '' }];
    }
    people.sort((a, b) => (a.nickname || a.email).localeCompare(b.nickname || b.email));
    setJobs(jobsData || []);
    setTodos(allTodos.filter(todo => !userRecord(todo.title) && !pushRecord(todo.title)));
    setPushSubs(allTodos.map(todo => pushRecord(todo.title)).filter(Boolean) as { email: string; subscription: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }[]);
    setUsers(people);
    setSavedCustomers(customerData || []);
    setLoading(false);
    if (email) notifyAssignedTasks(allTodos, email, setTaskAlerts);
  }

  async function saveNickname() {
    const email = session?.user?.email;
    if (!email) return;
    const { data, error } = await supabase.from('todos').select('id, title');
    if (error) { alert(error.message); return; }
    const mine = (data || []).find(todo => userRecord(todo.title)?.email === email);
    const title = userTitle(email, nicknameDraft);
    const result = mine
      ? await supabase.from('todos').update({ title }).eq('id', mine.id)
      : await supabase.from('todos').insert({ title });
    if (result.error) { alert(result.error.message); return; }
    setNicknameLoaded(true);
    await fetchData();
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

  async function enableTaskAlerts() {
    if (typeof Notification === 'undefined') { alert('This phone cannot show alerts.'); return; }
    if (Notification.permission === 'denied') {
      alert('Chrome locked this on Automatically blocked, so Allow cannot be tapped yet. Open the Chrome app, tap the three dots, Settings, Site settings, Notifications. Turn off Use quieter messaging. Then tap job-manager-bce.pages.dev and remove it. Open Reny and turn Task alerts on, then tap Allow.');
      return;
    }
    const result = await Notification.requestPermission();
    const allowed = result === 'granted';
    setNotifyOn(allowed);
    localStorage.setItem('reny-task-notify', allowed ? '1' : '0');
    if (!allowed) { alert('Tap Allow when the phone asks.'); return; }
    try { await showTaskNotification('Alerts are on'); } catch { /* the phone blocked it */ }
    if (session?.user?.email) {
      try { await savePushSubscription(session.user.email); } catch { /* this phone could not register */ }
    }
  }

  async function savePushSubscription(email: string) {
    if (!email || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.register('/sw.js');
    const current = await reg.pushManager.getSubscription();
    const subscription = current || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes() });
    const json = subscription.toJSON();
    const title = `@@push:${email}@@${JSON.stringify(json)}`;
    const { data } = await supabase.from('todos').select('id, title');
    const existing = (data || []).find(todo => {
      const saved = pushRecord(todo.title);
      return saved?.email === email && saved.subscription?.endpoint === json.endpoint;
    });
    if (existing) {
      if (existing.title !== title) await supabase.from('todos').update({ title }).eq('id', existing.id);
    } else {
      await supabase.from('todos').insert({ title });
    }
    await fetchData();
  }

  async function sendAssigneePush(email: string, body: string, tag: string) {
    const subscriptions = pushSubs.filter(item => item.email === email).map(item => item.subscription);
    if (!email || subscriptions.length === 0) return;
    try {
      await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptions, title: 'Task assigned to you', body, tag }),
      });
    } catch { /* the task is still saved */ }
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
    const job = jobs.find(item => item.id === id);
    if (!job) return;
    if (isEstimateJob(job)) {
      const current = readEstimate(job.notes);
      const estimate = completed ? (current === 'sent' || current === 'approved' ? current : 'needs') : 'open';
      const { error } = await supabase.from('jobs').update({ notes: packNotes(readEmail(job.notes), job.notes || '', '', undefined, undefined, undefined, estimate) }).eq('id', id);
      if (error) { alert(error.message); return; }
      if (completed) setActiveTab('estimates');
      await fetchData();
      return;
    }
    const patch: any = { status: completed ? 'completed' : 'scheduled' };
    if (completed && job && !readInvoice(job.notes)) {
      patch.notes = packNotes(readEmail(job.notes), job.notes || '', 'needs');
    }
    const { error } = await supabase.from('jobs').update(patch).eq('id', id);
    if (error) { alert(error.message); return; }
    await fetchData();
  }

  async function setInvoice(job: Job, invoice: string) {
    const { error } = await supabase.from('jobs').update({ notes: packNotes(readEmail(job.notes), job.notes || '', invoice) }).eq('id', job.id);
    if (error) { alert(error.message); return; }
    await fetchData();
  }

  async function setEstimate(job: Job, estimate: string) {
    const { error } = await supabase.from('jobs').update({ notes: packNotes(readEmail(job.notes), job.notes || '', '', undefined, undefined, undefined, estimate) }).eq('id', job.id);
    if (error) { alert(error.message); return; }
    await fetchData();
  }

  async function deleteJob(id: string) {
    if (!confirm('Delete this job?')) return;
    const { error } = await supabase.from('jobs').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    await fetchData();
  }

  async function addTodo(title: string, assignee: string, files: File[], audio: string) {
    const text = title.trim();
    const creator = session?.user?.email || '';
    const { photos, failed } = await filesToPhotos(files);
    if (failed.length) alert('Could not save: ' + failed.join(', '));
    if (!text && photos.length === 0 && !audio) {
      alert('Add a task, a photo, or a recording.');
      return;
    }
    const { data, error } = await supabase.from('todos').insert({ title: packTask(text, creator, assignee, photos, audio) }).select('id').single();
    if (error) { alert(error.message); return; }
    if (assignee) await sendAssigneePush(assignee, taskNoticeBody({ text, photos, audio }), data?.id ? `reny-${data.id}` : 'reny-task');
    setNewTaskTitle('');
    setNewTaskAssignee('');
    setNewTaskPhotos([]);
    setNewTaskAudio('');
    setShowTaskForm(false);
    await fetchData();
  }

  async function assignTodo(todo: Todo, assignee: string) {
    const parsed = unpackTask(todo.title);
    const creator = parsed.creator || session?.user?.email || '';
    const { error } = await supabase.from('todos').update({ title: packTask(parsed.text, creator, assignee, parsed.photos, parsed.audio) }).eq('id', todo.id);
    if (error) { alert(error.message); return; }
    if (assignee && assignee !== parsed.assignee) await sendAssigneePush(assignee, taskNoticeBody(parsed), `reny-${todo.id}`);
    await fetchData();
  }

  async function editTodo(todo: Todo, text: string, files: File[], audio: string) {
    const trimmed = text.trim();
    const parsed = unpackTask(todo.title);
    const { photos, failed } = await filesToPhotos(files);
    if (failed.length) alert('Could not save: ' + failed.join(', '));
    const nextPhotos = [...parsed.photos, ...photos];
    if (!trimmed && nextPhotos.length === 0 && !audio) {
      alert('Add a task, a photo, or a recording.');
      return;
    }
    const { error } = await supabase.from('todos').update({ title: packTask(trimmed, parsed.creator, parsed.assignee, nextPhotos, audio) }).eq('id', todo.id);
    if (error) { alert(error.message); return; }
    setEditingTodoId(null);
    setEditTaskPhotos([]);
    setEditTaskAudio('');
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
  if (!session) return <AuthScreen onSignIn={signIn} onSignUp={signUp} darkMode={darkMode} />;
  if (loading) return <div className="p-8 text-center">Loading jobs...</div>;

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: startOfWeek(monthStart, { weekStartsOn: 0 }), end: endOfWeek(monthEnd, { weekStartsOn: 0 }) });
  const customers = customerDirectory(jobs, savedCustomers);
  const jobsOnDate = (date: Date) => jobs.filter(job => (job.status === 'scheduled' || job.status === 'completed' || isEstimateJob(job)) && [job.scheduled_date, ...readExtraDates(job.notes)].some(value => value && isSameDay(new Date(value), date)));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex justify-between items-center sticky top-0 z-10">
        <div>
          <BrandLogo darkMode={darkMode} height={36} />
          <p className="text-xs text-gray-500 truncate max-w-[200px] sm:max-w-none">{session.user.email}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Settings" onClick={() => setSettingsOpen(open => !open)} className="p-2 text-gray-600">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
          <button onClick={signOut} className="text-sm text-gray-600 px-2 py-1">Sign out</button>
        </div>
      </header>
      {settingsOpen && (
        <>
          <button type="button" aria-label="Close settings" className="fixed inset-0 z-20" onClick={() => setSettingsOpen(false)} />
          <div className="fixed right-3 top-[60px] z-30 w-56 bg-white border rounded-lg shadow p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Dark mode</span>
              <button
                type="button"
                aria-label="Dark mode"
                onClick={() => {
                  const next = !darkMode;
                  setDarkMode(next);
                  localStorage.setItem('reny-dark', next ? '1' : '0');
                  document.documentElement.classList.toggle('dark', next);
                }}
                className={`w-11 h-6 rounded-full relative ${darkMode ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition ${darkMode ? 'translate-x-5' : ''}`} />
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t">
              <span className="text-sm">Task alerts</span>
              <button
                type="button"
                aria-label="Task alerts"
                onClick={() => { if (notifyOn) { setNotifyOn(false); localStorage.setItem('reny-task-notify', '0'); return; } enableTaskAlerts(); }}
                className={`w-11 h-6 rounded-full relative ${notifyOn ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition ${notifyOn ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Mobile-friendly nav */}
      <nav className="bg-white border-b flex overflow-x-auto px-2 sticky top-[68px] z-10">
        {(['calendar', 'unscheduled', 'estimates', 'completed', 'todos', 'customers', 'users', 'estimator'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-3 py-3 text-sm font-medium capitalize whitespace-nowrap flex-shrink-0 ${activeTab === tab ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}>
            {tab === 'todos' ? 'Task List' : tab}{tab === 'todos' && taskAlerts.length > 0 ? ` (${taskAlerts.length})` : ''}
          </button>
        ))}
      </nav>

      <main className="p-3 sm:p-4 max-w-7xl mx-auto pb-20">
        {activeTab === 'calendar' && (
          <div>
            <div className="flex gap-2 mb-3 flex-wrap items-center">
              <button type="button" onClick={() => setCalendarView('month')} className={`px-3 py-1.5 rounded text-sm ${calendarView === 'month' ? 'bg-blue-600 text-white' : 'border'}`}>Month</button>
              <button type="button" onClick={() => setCalendarView('week')} className={`px-3 py-1.5 rounded text-sm ${calendarView === 'week' ? 'bg-blue-600 text-white' : 'border'}`}>Week</button>
              <button type="button" onClick={() => setCalendarView('day')} className={`px-3 py-1.5 rounded text-sm ${calendarView === 'day' ? 'bg-blue-600 text-white' : 'border'}`}>Day</button>
              <button type="button" onClick={() => setCalendarView('tiles')} className={`px-3 py-1.5 rounded text-sm ${calendarView === 'tiles' ? 'bg-blue-600 text-white' : 'border'}`}>Tiles</button>
              <button type="button" onClick={() => { setEditingJob(null); setShowJobModal(true); }} className="ml-auto px-3 py-1.5 rounded text-sm bg-blue-600 text-white">+ Job</button>
              <button type="button" onClick={() => { setEditingJob({ status: 'estimate' } as any); setShowJobModal(true); }} className="px-3 py-1.5 rounded text-sm border border-sky-600 text-sky-700">+ Estimate</button>
            </div>
            {calendarView === 'month' ? (
            <>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-semibold">{format(currentMonth, 'MMMM yyyy')}</h2>
              <div className="flex gap-1">
                <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="px-2 py-1 border rounded text-sm">Prev</button>
                <button onClick={() => setCurrentMonth(new Date())} className="px-2 py-1 border rounded text-sm">Today</button>
                <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="px-2 py-1 border rounded text-sm">Next</button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-xs font-medium text-gray-500 mb-1">
              {['S','M','T','W','T','F','S'].map((d, i) => <div key={i}>{d}</div>)}
            </div>
            <div className="space-y-0.5 text-xs">
              {Array.from({ length: Math.ceil(days.length / 7) }, (_, weekIndex) => days.slice(weekIndex * 7, weekIndex * 7 + 7)).map(week => {
                const weekJobs = week.flatMap(day => jobsOnDate(day)).filter((job, index, list) => list.findIndex(item => item.id === job.id) === index);
                const spans = weekSpans(weekJobs, week);
                return (
                  <div key={week[0].toISOString()} className="relative">
                    <div className="grid grid-cols-7 gap-0.5">
                      {week.map(day => {
                        const dayJobs = jobsOnDate(day).filter(job => !jobCoversDayAsSpan(job, day));
                        const isToday = isSameDay(day, new Date());
                        const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                        return (
                          <div key={day.toISOString()} onClick={() => setSelectedDate(day)}
                            className={`relative min-h-16 sm:min-h-24 p-0.5 border rounded cursor-pointer hover:bg-blue-50 ${!isSameMonth(day, currentMonth) ? 'bg-gray-100' : 'bg-white'} ${isSelected ? 'bg-blue-50' : ''} ${isToday ? 'ring-2 ring-blue-500' : ''}`}
                            style={spans.length ? { paddingTop: 18 + spans.reduce((max, span) => Math.max(max, span.lane + 1), 0) * 16 } : undefined}>
                            <div className="absolute top-0.5 right-1 font-medium">{format(day, 'd')}</div>
                            {dayJobs.slice(0, 1).map(j => <div key={j.id} onClick={e => { e.stopPropagation(); setViewingJob(j); }} className={`px-0.5 rounded truncate mt-0.5 ${jobColor(j).chip}`}>{isEstimateJob(j) ? 'Est: ' : ''}{j.customer_name || j.title}</div>)}
                            {dayJobs.length > 1 && <div className="text-gray-500">+{dayJobs.length - 1}</div>}
                          </div>
                        );
                      })}
                    </div>
                    <div className="pointer-events-none absolute inset-0 grid grid-cols-7 gap-0.5">
                      {spans.map(span => (
                        <button
                          type="button"
                          key={`${span.job.id}-${span.start}`}
                          onClick={e => { e.stopPropagation(); setViewingJob(span.job); }}
                          className={`pointer-events-auto z-10 mx-0.5 h-4 truncate rounded px-1 text-left text-[10px] font-medium ${scheduleBlockClass(span.job)}`}
                          style={{ gridColumn: `${span.start + 1} / span ${span.length}`, gridRow: 1, alignSelf: 'start', marginTop: 16 + span.lane * 16 }}
                        >
                          {isEstimateJob(span.job) ? 'Est: ' : ''}{span.job.customer_name || span.job.address || 'Job'}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedDate && (
              <div className="mt-4">
                <h3 className="font-medium mb-2 text-sm">Jobs on {format(selectedDate, 'PPP')}</h3>
                {jobsOnDate(selectedDate).map(job => (
                  <JobCard key={job.id} job={job} showCompletedCheck onOpen={() => setViewingJob(job)} onToggleComplete={(done: boolean) => setJobCompleted(job.id, done)} onEdit={() => { setEditingJob(job); setShowJobModal(true); }} onDelete={() => deleteJob(job.id)} />
                ))}
                {jobsOnDate(selectedDate).length === 0 && <p className="text-gray-500 text-sm">Nothing scheduled this day.</p>}
              </div>
            )}
            </>
            ) : calendarView === 'week' ? (
              <WeekView
                selectedDate={selectedDate || new Date()}
                jobsOnDate={jobsOnDate}
                onShift={next => setSelectedDate(next)}
                onOpen={job => setViewingJob(job)}
              />
            ) : calendarView === 'day' ? (
              <DayView
                selectedDate={selectedDate || new Date()}
                jobsOnDate={jobsOnDate}
                onShift={next => setSelectedDate(next)}
                onOpen={job => setViewingJob(job)}
              />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {jobs.filter(job => (job.status === 'scheduled' || job.status === 'completed' || isEstimateJob(job)) && (job.scheduled_date || readExtraDates(job.notes).length)).slice().sort((a, b) => new Date(a.scheduled_date || readExtraDates(a.notes)[0] || 0).getTime() - new Date(b.scheduled_date || readExtraDates(b.notes)[0] || 0).getTime()).map(job => (
                  <button
                    type="button"
                    key={job.id}
                    onClick={() => setViewingJob(job)}
                    className={`job-tile text-left rounded-lg border p-3 min-h-28 ${jobColor(job).card}`}
                  >
                    <div className="font-medium">{job.customer_name || 'No name'}</div>
                    <div className="text-sm mt-1">{job.address || 'No address'}</div>
                    <div className="text-sm mt-1 line-clamp-3">{job.description || 'No description'}</div>
                  </button>
                ))}
                {jobs.filter(job => (job.status === 'scheduled' || job.status === 'completed' || isEstimateJob(job)) && (job.scheduled_date || readExtraDates(job.notes).length)).length === 0 && <p className="text-gray-500 text-sm col-span-2">No scheduled jobs yet.</p>}
              </div>
            )}
          </div>
        )}

        {activeTab === 'unscheduled' && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-semibold">Unscheduled Jobs</h2>
              <button type="button" onClick={() => { setEditingJob(null); setShowJobModal(true); }} className="px-3 py-1.5 rounded text-sm bg-blue-600 text-white">+ Job</button>
            </div>
            {jobs.filter(j => j.status === 'unscheduled' && !estimateStage(j.notes)).map(job => (
              <JobCard key={job.id} job={job} onOpen={() => setViewingJob(job)} onEdit={() => { setEditingJob(job); setShowJobModal(true); }} onDelete={() => deleteJob(job.id)} />
            ))}
            {jobs.filter(j => j.status === 'unscheduled' && !estimateStage(j.notes)).length === 0 && <p className="text-gray-500">None yet. Leave the date blank.</p>}
          </div>
        )}

        {activeTab === 'estimates' && (
          <div>
            <div className="flex gap-2 mb-3 flex-wrap">
              {([['all', 'All'], ['needs', 'Needs estimate'], ['sent', 'Estimate sent'], ['approved', 'Approved']] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setEstimateFilter(key)} className={`px-3 py-1.5 rounded text-sm ${estimateFilter === key ? 'bg-sky-600 text-white' : 'border'}`}>{label}</button>
              ))}
            </div>
            {jobs.filter(job => !!estimateStage(job.notes) && (estimateFilter === 'all' || estimateStage(job.notes) === estimateFilter)).map(job => (
              <JobCard key={job.id} job={job} onEstimate={(estimate: string) => setEstimate(job, estimate)} onEdit={() => { setEditingJob(job); setShowJobModal(true); }} onDelete={() => deleteJob(job.id)} />
            ))}
            {jobs.filter(job => !!estimateStage(job.notes) && (estimateFilter === 'all' || estimateStage(job.notes) === estimateFilter)).length === 0 && <p className="text-gray-500">None yet. Check Completed on a calendar estimate.</p>}
          </div>
        )}

        {activeTab === 'completed' && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Completed Jobs</h2>
            <div className="flex flex-wrap gap-2 mb-3">
              {([['all', 'All'], ['needs', 'Needs invoice'], ['sent', 'Invoice sent'], ['paid', 'Paid']] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setInvoiceFilter(key)} className={`px-3 py-1.5 rounded text-sm ${invoiceFilter === key ? 'bg-blue-600 text-white' : 'border'}`}>{label}</button>
              ))}
            </div>
            {jobs.filter(job => job.status === 'completed' && (invoiceFilter === 'all' || (readInvoice(job.notes) || 'needs') === invoiceFilter)).map(job => (
              <JobCard key={job.id} job={job} onInvoice={(invoice: string) => setInvoice(job, invoice)} onEdit={() => { setEditingJob(job); setShowJobModal(true); }} onDelete={() => deleteJob(job.id)} />
            ))}
            {jobs.filter(job => job.status === 'completed' && (invoiceFilter === 'all' || (readInvoice(job.notes) || 'needs') === invoiceFilter)).length === 0 && <p className="text-gray-500">None yet</p>}
          </div>
        )}

        {activeTab === 'todos' && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-semibold">Task List</h2>
              <button onClick={() => { setShowTaskForm(true); setNewTaskAudio(''); setNewTaskPhotos([]); }} className="text-sm text-blue-600">+ New Task</button>
            </div>
            {!notifyOn && (
              <button type="button" onClick={enableTaskAlerts} className="w-full mb-3 bg-blue-600 text-white rounded-lg py-3">Turn on alerts</button>
            )}
            {showTaskForm && (
              <form onSubmit={e => { e.preventDefault(); addTodo(newTaskTitle, newTaskAssignee, newTaskPhotos, newTaskAudio); }} className="bg-white p-3 rounded-lg border mb-3 space-y-2">
                <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Task (optional if you add a photo)" className="w-full border rounded px-3 py-2" />
                <select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)} className="w-full border rounded px-3 py-2">
                  <option value="">Assign to...</option>
                  {users.map(person => (
                    <option key={person.email} value={person.email}>{person.nickname || person.email}</option>
                  ))}
                </select>
                <input type="file" accept="image/*" multiple onChange={e => setNewTaskPhotos(Array.from(e.target.files || []))} className="w-full text-sm" />
                <VoiceNote audio={newTaskAudio} onChange={setNewTaskAudio} />
                <div className="flex gap-2">
                  <button className="bg-blue-600 text-white px-3 py-2 rounded text-sm">Save</button>
                  <button type="button" onClick={() => setShowTaskForm(false)} className="px-3 py-2 border rounded text-sm">Cancel</button>
                </div>
              </form>
            )}
            {todos.map(todo => {
              const task = unpackTask(todo.title);
              const creator = users.find(person => person.email === task.creator);
              return (
                <div key={todo.id} className="bg-white p-3 rounded-lg border mb-2">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={todo.completed} onChange={() => toggleTodo(todo.id, todo.completed)} className="w-5 h-5 mt-1" />
                    <div className="flex-1 min-w-0">
                      {editingTodoId === todo.id ? (
                        <form onSubmit={e => { e.preventDefault(); editTodo(todo, editTaskTitle, editTaskPhotos, editTaskAudio); }} className="space-y-2">
                          <input value={editTaskTitle} onChange={e => setEditTaskTitle(e.target.value)} placeholder="Task (optional if you add a photo)" className="border rounded px-2 py-1 w-full" />
                          <input type="file" accept="image/*" multiple onChange={e => setEditTaskPhotos(Array.from(e.target.files || []))} className="w-full text-sm" />
                          <VoiceNote audio={editTaskAudio} onChange={setEditTaskAudio} />
                          <div className="flex gap-2">
                            <button className="text-blue-600 text-sm">Save</button>
                            <button type="button" onClick={() => { setEditingTodoId(null); setEditTaskPhotos([]); }} className="text-gray-500 text-sm">Cancel</button>
                          </div>
                        </form>
                      ) : (
                        task.text ? <div className={todo.completed ? 'line-through text-gray-400' : ''}>{task.text}</div> : null
                      )}
                      {task.photos.length > 0 && <PhotoGallery urls={task.photos} />}
                      {task.audio && <div className="mt-2"><VoiceNote audio={task.audio} /></div>}
                      <p className="text-xs text-gray-500 mt-1">Created{todo.created_at ? ` ${format(new Date(todo.created_at), 'PPp')}` : ''} by {creator?.nickname || task.creator || 'Unknown'}</p>
                      <label className="block text-xs text-gray-500 mt-2">Assigned to</label>
                      <select value={task.assignee} onChange={e => assignTodo(todo, e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm mt-1">
                        <option value="">Unassigned</option>
                        {users.map(person => (
                          <option key={person.email} value={person.email}>{person.nickname || person.email}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1 text-sm">
                      <button onClick={() => { setEditingTodoId(todo.id); setEditTaskTitle(task.text); setEditTaskPhotos([]); setEditTaskAudio(task.audio); }} className="text-blue-600">Edit</button>
                      <button onClick={() => deleteTodo(todo.id)} className="text-red-500">Delete</button>
                    </div>
                  </div>
                </div>
              );
            })}
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
                          <div className="font-medium">{job.customer_name || 'No name'}</div>
                          <div className="text-sm text-gray-700">{job.address || 'No address'}</div>
                          <div className="text-sm text-gray-700">{job.description || 'No description'}</div>
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

        {activeTab === 'users' && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Users</h2>
            <div className="bg-white p-3 rounded-lg border mb-4">
              <label className="text-sm text-gray-600">Your nickname</label>
              <div className="flex gap-2 mt-2">
                <input value={nicknameDraft} onChange={e => setNicknameDraft(e.target.value)} placeholder="Nickname" className="border rounded px-3 py-2 flex-1" />
                <button onClick={saveNickname} className="bg-blue-600 text-white px-3 py-2 rounded">Save</button>
              </div>
            </div>
            {users.map(person => (
              <div key={person.email} className="bg-white p-3 rounded-lg border mb-2">
                <h3 className="font-medium">{person.nickname || person.email}</h3>
                {person.nickname && <p className="text-sm text-gray-500">{person.email}</p>}
              </div>
            ))}
            {users.length === 0 && <p className="text-gray-500">No users yet.</p>}
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
      {taskAlerts.length > 0 && (
        <button type="button" onClick={() => { setActiveTab('todos'); setTaskAlerts([]); }} className="fixed bottom-4 left-3 right-3 z-40 bg-blue-600 text-white rounded-lg px-4 py-3 shadow text-left">
          <div className="font-medium">Task assigned to you</div>
          <div className="text-sm truncate">{taskAlerts[0]}</div>
        </button>
      )}
      {viewingJob && (
        <JobDetails
          job={viewingJob}
          onClose={() => setViewingJob(null)}
          onEdit={() => { setEditingJob(viewingJob); setViewingJob(null); setShowJobModal(true); }}
        />
      )}
    </div>
  );
}

function BrandLogo({ darkMode, height, className }: { darkMode?: boolean; height: number; className?: string }) {
  const width = Math.round(height * 2647 / 623);
  if (!darkMode) return <img src="/logo.png" alt="Reny Plumbing" className={className} style={{ height, width }} />;
  return (
    <div
      role="img"
      aria-label="Reny Plumbing"
      className={className}
      style={{
        height,
        width,
        backgroundColor: '#2563eb',
        WebkitMaskImage: 'url(/logo.png)',
        maskImage: 'url(/logo.png)',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  );
}

function AuthScreen({ onSignIn, onSignUp, darkMode }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-6 rounded-xl border max-w-md w-full">
        <BrandLogo darkMode={darkMode} height={64} className="mx-auto mb-6" />
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

function JobCard({ job, onEdit, onDelete, onToggleComplete, showCompletedCheck, onInvoice, onEstimate, onOpen }: any) {
  const invoice = invoiceKey(job);
  const estimate = isEstimateJob(job) ? (readEstimate(job.notes) || 'needs') : '';
  const color = jobColor(job);
  const when = [job.scheduled_date, ...readExtraDates(job.notes)].filter(Boolean);
  const info = (
    <>
      <h3 className="font-medium">{job.customer_name || 'No name'}</h3>
      <p className="text-sm text-gray-700 mt-1">{job.address || 'No address'}</p>
      <p className="text-sm text-gray-700 mt-1">{job.description || 'No description'}</p>
      {when.length > 0 && <p className="text-sm text-blue-600 mt-1">{formatJobSchedule(job)}</p>}
    </>
  );
  return (
    <div className={`job-card p-3 sm:p-4 rounded-lg border mb-3 ${color.card}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          {onOpen ? <button type="button" onClick={onOpen} className="w-full text-left">{info}</button> : info}
          <ContactActions phone={job.customer_phone} address={job.address} />
          {job.photos && job.photos.length > 0 && <PhotoGallery urls={job.photos} />}
          {showCompletedCheck && (
            <label className="flex items-center gap-2 mt-3 text-sm font-medium text-gray-900">
              <input type="checkbox" className="w-5 h-5" checked={job.status === 'completed' || !!estimateStage(job.notes)} onChange={() => onToggleComplete(!(job.status === 'completed' || estimateStage(job.notes)))} />
              Completed
            </label>
          )}
          {job.status === 'completed' && onInvoice && !estimate && (
            <div className="mt-3">
              <p className="text-xs text-gray-600 mb-1">Status</p>
              <div className="flex flex-wrap gap-1">
                {([['needs', 'Needs invoice'], ['sent', 'Invoice sent'], ['paid', 'Paid']] as const).map(([key, label]) => (
                  <button type="button" key={key} onClick={() => onInvoice(key)} className={`px-2 py-1 rounded text-xs border ${invoice === key ? invoiceColor(key).on : 'bg-white'}`}>{label}</button>
                ))}
              </div>
            </div>
          )}
          {estimate && onEstimate && (
            <div className="mt-3">
              <p className="text-xs text-gray-600 mb-1">Status</p>
              <div className="flex flex-wrap gap-1">
                {([['needs', 'Needs estimate'], ['sent', 'Estimate sent'], ['approved', 'Approved']] as const).map(([key, label]) => (
                  <button type="button" key={key} onClick={() => onEstimate(key)} className={`px-2 py-1 rounded text-xs border ${estimate === key ? estimateColor(key).on : 'bg-white text-gray-900'}`}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 text-sm flex-shrink-0">
          <button onClick={onEdit} className="text-blue-600">Edit</button>
          <button onClick={onDelete} className="text-red-500">Delete</button>
        </div>
      </div>
    </div>
  );
}

function JobDetails({ job, onClose, onEdit }: { job: Job; onClose: () => void; onEdit: () => void }) {
  const email = readEmail(job.notes);
  const notes = readNotes(job.notes);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start gap-3">
          <h2 className="text-lg font-semibold">{job.customer_name || 'No customer'}</h2>
          <button type="button" onClick={onEdit} className="text-blue-600 shrink-0">Edit</button>
        </div>
        <div className="mt-3 text-sm text-gray-700 space-y-1">
          <p>Name: {job.customer_name || 'None'}</p>
          <p>Address: {job.address || 'None'}</p>
          <p>Description: {job.description || 'None'}</p>
          <p>Phone: {job.customer_phone || 'None'}</p>
          <p>Email: {email || 'None'}</p>
          <p className="text-blue-600">{formatJobSchedule(job) || 'Unscheduled'}</p>
        </div>
        <ContactActions phone={job.customer_phone} address={job.address} />
        {notes && <p className="mt-3 text-sm whitespace-pre-wrap">{notes}</p>}
        {job.photos && job.photos.length > 0 && <PhotoGallery urls={job.photos} />}
        <button type="button" onClick={onClose} className="mt-4 w-full border rounded py-2">Close</button>
      </div>
    </div>
  );
}

function JobModal({ job, customers, onClose, onSave, defaultDate }: any) {
  const initialWhen = toLocalInput(job?.scheduled_date);
  const [jobDate, setJobDate] = useState(initialWhen ? initialWhen.slice(0, 10) : (defaultDate ? format(defaultDate, 'yyyy-MM-dd') : ''));
  const [jobTime, setJobTime] = useState(job?.scheduled_date && !readAllDay(job?.notes) && initialWhen ? initialWhen.slice(11, 16) : '');
  const [endTime, setEndTime] = useState(readUntil(job?.notes));
  const [showRange, setShowRange] = useState(!!readUntil(job?.notes));
  const [extraDates, setExtraDates] = useState<string[]>(() => readExtraDates(job?.notes).map(value => toLocalInput(value)));
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
    const isEstimate = job?.status === 'estimate' || !!readEstimate(job?.notes);
    const data: any = {
      title: form.customer_name.trim(),
      description: form.description || null,
      status: form.status,
      customer_name: form.customer_name || null,
      customer_phone: form.customer_phone || null,
      address: form.address || null,
      notes: packNotes(
        form.customer_email,
        form.notes,
        isEstimate ? '' : readInvoice(job?.notes),
        jobDate ? extraDates.filter(Boolean).map(value => new Date(value).toISOString()) : [],
        jobDate && showRange && endTime ? endTime : '',
        !!(jobDate && !jobTime && !(showRange && endTime)),
        isEstimate ? (estimateStage(job?.notes) || 'open') : '',
      ),
      estimated_hours: form.estimated_hours ? +form.estimated_hours : null,
      hourly_rate: form.hourly_rate ? +form.hourly_rate : null,
      material_cost: form.material_cost ? +form.material_cost : null,
      markup_percent: +form.markup_percent || 20,
    };
    if (jobDate) {
      data.scheduled_date = new Date(`${jobDate}T${jobTime || '00:00'}`).toISOString();
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
        <h2 className="text-xl font-semibold mb-4">{(job?.status === 'estimate' || readEstimate(job?.notes)) ? (job?.id ? 'Edit Estimate' : 'New Estimate') : (job?.id ? 'Edit Job' : 'New Job')}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <input
              required
              placeholder="Customer name *"
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
          <textarea placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full border rounded px-3 py-2" rows={2} />
          <div>
            <label className="text-sm text-gray-600">Date</label>
            <input type="date" value={jobDate} onChange={e => setJobDate(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="text-sm text-gray-600">Time</label>
            <input type="time" value={jobTime} onChange={e => setJobTime(e.target.value)} className="w-full border rounded px-3 py-2" />
            {showRange ? (
              <div className="flex gap-2 mt-2">
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="flex-1 border rounded px-3 py-2" />
                <button type="button" onClick={() => { setShowRange(false); setEndTime(''); }} className="px-3 border rounded text-sm">Remove</button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowRange(true)} className="block text-sm text-blue-600 mt-1">+ Add range</button>
            )}
          </div>
          {extraDates.map((value, index) => (
            <div key={index} className="flex gap-2">
              <input type="datetime-local" value={value} onChange={e => setExtraDates(extraDates.map((item, itemIndex) => itemIndex === index ? e.target.value : item))} className="flex-1 border rounded px-3 py-2" />
              <button type="button" onClick={() => setExtraDates(extraDates.filter((_, itemIndex) => itemIndex !== index))} className="px-3 border rounded text-sm">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => setExtraDates([...extraDates, ''])} className="text-sm text-blue-600">+ Add Date</button>
          <p className="text-xs text-gray-500 -mt-2">Leave the first date blank for Unscheduled. Extra dates also show on the calendar.</p>
          <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full border rounded px-3 py-2" rows={3} />
          <div>
            <label className="text-sm text-gray-600">Photos</label>
            <input type="file" accept="image/*" multiple onChange={e => setNewPhotos(Array.from(e.target.files || []))} className="w-full text-sm mt-1" />
            {job?.photos && job.photos.length > 0 && <PhotoGallery urls={job.photos} />}
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

function scheduleBlockClass(job: Job) {
  const stage = estimateStage(job.notes);
  if (stage) return estimateColor(stage).block;
  const key = invoiceKey(job);
  if (key) return invoiceColor(key).block;
  return 'bg-violet-300 text-violet-950';
}

function scheduleLabel(job: Job) {
  const label = job.address || job.customer_name || 'Job';
  return isEstimateJob(job) ? `Est: ${label}` : label;
}

function uniqueJobDays(job: Job) {
  const values = [job.scheduled_date, ...readExtraDates(job.notes)].filter((value): value is string => !!value);
  const seen = new Set<string>();
  const days: Date[] = [];
  for (const value of values) {
    const day = startOfDay(new Date(value));
    if (Number.isNaN(day.getTime())) continue;
    const key = format(day, 'yyyy-MM-dd');
    if (seen.has(key)) continue;
    seen.add(key);
    days.push(day);
  }
  days.sort((a, b) => a.getTime() - b.getTime());
  return days;
}

function jobCoversDayAsSpan(job: Job, day: Date) {
  const days = uniqueJobDays(job);
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (differenceInCalendarDays(days[i], days[i - 1]) === 1) run += 1;
    else run = 1;
    if (run > 1 && days.slice(i - run + 1, i + 1).some(item => isSameDay(item, day))) return true;
  }
  return false;
}

function weekSpans(jobs: Job[], weekDays: Date[]) {
  const spans: { job: Job; start: number; length: number; lane: number }[] = [];
  const pending: { job: Job; start: number; length: number }[] = [];
  for (const job of jobs) {
    const days = uniqueJobDays(job);
    let runStart = 0;
    for (let i = 0; i <= days.length; i += 1) {
      const broken = i === days.length || (i > 0 && differenceInCalendarDays(days[i], days[i - 1]) !== 1);
      if (broken && i - runStart > 1) {
        const run = days.slice(runStart, i);
        let start = -1;
        let length = 0;
        weekDays.forEach((day, index) => {
          if (run.some(item => isSameDay(item, day))) {
            if (start === -1) start = index;
            length += 1;
          }
        });
        if (length > 0) pending.push({ job, start, length });
      }
      if (broken) runStart = i;
    }
  }
  pending.sort((a, b) => a.start - b.start || b.length - a.length);
  const laneEnds: number[] = [];
  for (const span of pending) {
    let lane = laneEnds.findIndex(end => end <= span.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = span.start + span.length;
    spans.push({ ...span, lane });
  }
  return spans;
}

function DayView({ selectedDate, jobsOnDate, onShift, onOpen }: { selectedDate: Date; jobsOnDate: (date: Date) => Job[]; onShift: (next: Date) => void; onOpen: (job: Job) => void }) {
  const hours = Array.from({ length: WEEK_END_HOUR - WEEK_START_HOUR }, (_, i) => WEEK_START_HOUR + i);
  const row = 64;
  const gridHeight = hours.length * row;
  const items = placeDayJobs(jobsOnDate(selectedDate), selectedDate);
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <div>
          <div className="text-xs uppercase text-gray-500">{format(selectedDate, 'EEEE')}</div>
          <h2 className={`text-3xl font-semibold leading-none ${isSameDay(selectedDate, new Date()) ? 'text-blue-600' : ''}`}>{format(selectedDate, 'd')}</h2>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onShift(subDays(selectedDate, 1))} className="px-2 py-1 border rounded text-sm">Prev</button>
          <button onClick={() => onShift(new Date())} className="px-2 py-1 border rounded text-sm">Today</button>
          <button onClick={() => onShift(addDays(selectedDate, 1))} className="px-2 py-1 border rounded text-sm">Next</button>
        </div>
      </div>
      <div className="overflow-auto max-h-[75vh] border rounded bg-white">
        <div className="grid" style={{ gridTemplateColumns: '52px 1fr', height: gridHeight }}>
          <div>
            {hours.map(hour => (
              <div key={hour} className="text-[11px] text-gray-400 text-right pr-2" style={{ height: row }}>{format(new Date(2000, 0, 1, hour), 'h a')}</div>
            ))}
          </div>
          <div className="relative border-l" style={{ height: gridHeight }}>
            {hours.map(hour => <div key={hour} className="border-t border-gray-200" style={{ height: row }} />)}
            {items.map(item => (
              <button
                type="button"
                key={item.job.id}
                onClick={() => onOpen(item.job)}
                className={`absolute overflow-hidden rounded-2xl px-2 py-1 text-left text-sm leading-tight font-medium ${scheduleBlockClass(item.job)}`}
                style={{
                  top: ((item.a - WEEK_START_HOUR * 60) / 60) * row,
                  height: Math.max(36, ((item.b - item.a) / 60) * row - 6),
                  left: `calc(${(item.col / item.cols) * 100}% + 6px)`,
                  width: `calc(${100 / item.cols}% - 12px)`,
                }}
              >
                <span className="break-words">{scheduleLabel(item.job)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function WeekView({ selectedDate, jobsOnDate, onShift, onOpen }: { selectedDate: Date; jobsOnDate: (date: Date) => Job[]; onShift: (next: Date) => void; onOpen: (job: Job) => void }) {
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
  const hours = Array.from({ length: WEEK_END_HOUR - WEEK_START_HOUR }, (_, i) => WEEK_START_HOUR + i);
  const gridHeight = hours.length * HOUR_HEIGHT;
  const weekJobs = weekDays.flatMap(day => jobsOnDate(day)).filter((job, index, list) => list.findIndex(item => item.id === job.id) === index);
  const spans = weekSpans(weekJobs, weekDays);
  const spanLanes = spans.reduce((max, span) => Math.max(max, span.lane + 1), 0);
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">{format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d')}</h2>
        <div className="flex gap-1">
          <button onClick={() => onShift(subWeeks(selectedDate, 1))} className="px-2 py-1 border rounded text-sm">Prev</button>
          <button onClick={() => onShift(new Date())} className="px-2 py-1 border rounded text-sm">Today</button>
          <button onClick={() => onShift(addWeeks(selectedDate, 1))} className="px-2 py-1 border rounded text-sm">Next</button>
        </div>
      </div>
      <div className="overflow-auto max-h-[70vh] border rounded bg-white">
        <div className="min-w-[680px]">
          <div className="sticky top-0 z-10 grid bg-white border-b" style={{ gridTemplateColumns: '44px repeat(7, 1fr)' }}>
            <div />
            {weekDays.map(day => (
              <div key={day.toISOString()} className="text-center py-1 border-l">
                <div className={`text-lg font-semibold leading-none ${isSameDay(day, new Date()) ? 'text-blue-600' : ''}`}>{format(day, 'd')}</div>
                <div className="text-[10px] text-gray-500">{format(day, 'EEE')}</div>
              </div>
            ))}
          </div>
          {spanLanes > 0 && (
            <div className="grid border-b" style={{ gridTemplateColumns: '44px minmax(0, 1fr)' }}>
              <div />
              <div className="relative" style={{ height: spanLanes * 22 }}>
                <div className="absolute inset-0 grid grid-cols-7">
                  {spans.map(span => (
                    <button
                      type="button"
                      key={`${span.job.id}-${span.start}`}
                      onClick={() => onOpen(span.job)}
                      className={`z-10 mx-0.5 h-5 truncate rounded px-1 text-left text-[11px] font-medium ${scheduleBlockClass(span.job)}`}
                      style={{ gridColumn: `${span.start + 1} / span ${span.length}`, gridRow: 1, alignSelf: 'start', marginTop: span.lane * 22 }}
                    >
                      {isEstimateJob(span.job) ? 'Est: ' : ''}{span.job.customer_name || span.job.address || 'Job'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="grid" style={{ gridTemplateColumns: '44px repeat(7, 1fr)', height: gridHeight }}>
            <div>
              {hours.map(hour => (
                <div key={hour} className="text-[10px] text-gray-400 text-right pr-1" style={{ height: HOUR_HEIGHT }}>{format(new Date(2000, 0, 1, hour), 'h a')}</div>
              ))}
            </div>
            {weekDays.map(day => (
              <div key={day.toISOString()} className="relative border-l" style={{ height: gridHeight }}>
                {hours.map(hour => <div key={hour} className="border-t border-gray-200" style={{ height: HOUR_HEIGHT }} />)}
                {placeDayJobs(jobsOnDate(day).filter(job => !jobCoversDayAsSpan(job, day)), day).map(item => (
                  <button
                    type="button"
                    key={item.job.id}
                    onClick={() => onOpen(item.job)}
                    className={`absolute overflow-hidden rounded-2xl px-1 py-0.5 text-left text-[11px] leading-tight font-medium ${scheduleBlockClass(item.job)}`}
                    style={{
                      top: ((item.a - WEEK_START_HOUR * 60) / 60) * HOUR_HEIGHT,
                      height: Math.max(18, ((item.b - item.a) / 60) * HOUR_HEIGHT - 2),
                      left: `calc(${(item.col / item.cols) * 100}% + 1px)`,
                      width: `calc(${100 / item.cols}% - 3px)`,
                    }}
                  >
                    <span className="break-words">{scheduleLabel(item.job)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
