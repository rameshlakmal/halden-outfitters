'use client';
// Add a product (admin): details, price, photos and opening stock. Photos upload straight to Vercel Blob when the
// project has a Blob store; without one (local development) a path under /images/ on the shop works too.
import type { StaffProduct } from '@halden/contracts';
import { Plus, Trash, UploadSimple } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { upload } from '@vercel/blob/client';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { SHOP_URL } from '@/lib/shop';
import { errorMessage } from '../account/forms';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { inputClass, PageHead, Panel, textareaClass } from './ui';

type Photo = { url: string; alt: string };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/** A photo's address to show here: uploads are absolute; /images/... paths live on the shop. */
const preview = (url: string) => (url.startsWith('/') ? `${SHOP_URL}${url}` : url);

export function NewProduct() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => get<{ items: { slug: string; name: string }[] }>('/categories'),
    staleTime: 300_000,
  });
  const uploads = useQuery({
    queryKey: ['uploads-enabled'],
    queryFn: () => fetch('/api/upload').then((r) => r.json() as Promise<{ enabled: boolean }>),
    staleTime: Infinity,
  });

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [details, setDetails] = useState<[string, string][]>([['', '']]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [path, setPath] = useState('');
  const [uploading, setUploading] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 6 - photos.length)) {
        const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
        const blob = await upload(`products/${slug || 'photo'}.${ext}`, file, {
          access: 'public',
          handleUploadUrl: '/api/upload',
          contentType: file.type,
        });
        setPhotos((p) => [...p, { url: blob.url, alt: name ? `${name}` : '' }]);
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'The upload failed.', 'error');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    const amount = (k: string) => (text(k) === '' ? null : Number(text(k)).toFixed(2));
    const int = (k: string, fallback: number) => (text(k) === '' ? fallback : Number(text(k)));
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const created = await post<StaffProduct>('/staff/products', {
        name: name.trim(),
        slug,
        sku: text('sku'),
        category: text('category'),
        summary: text('summary'),
        description: text('description'),
        details: details.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v.trim()]),
        price: amount('price') ?? '',
        compareAtPrice: amount('compareAtPrice'),
        initialStock: int('initialStock', 0),
        lowStockThreshold: int('lowStockThreshold', 5),
        active: f.get('active') === 'on',
        featured: f.get('featured') === 'on',
        returnable: f.get('returnable') === 'on',
        sized: f.get('sized') === 'on',
        images: photos.map((p) => ({ url: p.url, alt: p.alt.trim() || name.trim() })),
      });
      toast.show(`${created.name} added`);
      void qc.invalidateQueries({ queryKey: ['staff', 'products'] });
      router.push(`/products/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setFields(err.fields);
        setError('Please check the highlighted fields.');
      } else setError(errorMessage(err));
      setBusy(false);
    }
  };

  const label = 'grid gap-1.5 text-[13px] font-medium';
  const field = (k: string, cls = inputClass) => (fields[k] ? `${cls} border-danger` : cls);
  const msg = (k: string) =>
    fields[k] ? <span className="text-[12.5px] font-normal text-danger">{fields[k]}</span> : null;
  const photoError = Object.entries(fields).find(([k]) => k.startsWith('images'))?.[1];

  return (
    <>
      <PageHead title="New product" sub="It shows in the shop once saved and switched on." />
      <form onSubmit={submit} noValidate className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid content-start gap-5">
          <Panel title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                Name
                <input
                  className={field('name')}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slugTouched) setSlug(slugify(e.target.value));
                  }}
                  maxLength={80}
                />
                {msg('name')}
              </label>
              <label className={label}>
                Address
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] text-ink-3">/products/</span>
                  <input
                    className={field('slug')}
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(slugify(e.target.value));
                    }}
                  />
                </div>
                {msg('slug')}
              </label>
              <label className={label}>
                SKU
                <input
                  name="sku"
                  className={`${field('sku')} uppercase`}
                  placeholder="HO-CAMPLAMP"
                  autoComplete="off"
                />
                {msg('sku')}
              </label>
              <label className={label}>
                Category
                <select name="category" className={field('category')} defaultValue="">
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {(categories.data?.items ?? []).map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {msg('category')}
              </label>
            </div>
            <label className={label}>
              Summary (one sentence, shown on cards)
              <input name="summary" className={field('summary')} maxLength={200} />
              {msg('summary')}
            </label>
            <label className={label}>
              Description
              <textarea
                name="description"
                className={`${field('description', textareaClass)} min-h-32`}
                maxLength={4000}
              />
              {msg('description')}
            </label>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-medium">Details (shown as a list on the product page)</legend>
              {details.map(([k, v], i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] gap-2">
                  <input
                    className={inputClass}
                    aria-label={`Detail ${i + 1} label`}
                    placeholder="Weight"
                    value={k}
                    onChange={(e) => setDetails((d) => d.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
                  />
                  <input
                    className={inputClass}
                    aria-label={`Detail ${i + 1} value`}
                    placeholder="240 g"
                    value={v}
                    onChange={(e) => setDetails((d) => d.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove detail ${i + 1}`}
                    onClick={() => setDetails((d) => (d.length > 1 ? d.filter((_, j) => j !== i) : [['', '']]))}
                  >
                    <Trash className="size-4" />
                  </Button>
                </div>
              ))}
              {details.length < 12 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  icon={<Plus className="size-4" />}
                  onClick={() => setDetails((d) => [...d, ['', '']])}
                >
                  Add a detail
                </Button>
              )}
            </fieldset>
          </Panel>

          <Panel title="Photos">
            <p className="text-[13px] text-ink-3">
              The first photo is the one on cards. Up to 6; JPEG, PNG, WebP or AVIF, 5 MB each.
            </p>
            {photos.length > 0 && (
              <ul className="grid gap-3 sm:grid-cols-2">
                {photos.map((p, i) => (
                  <li key={p.url} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3">
                    <img
                      src={preview(p.url)}
                      alt=""
                      className="size-[72px] rounded-[var(--radius-field)] bg-surface-2 object-cover"
                    />
                    <input
                      className={inputClass}
                      aria-label={`Photo ${i + 1} description`}
                      placeholder="What the photo shows"
                      value={p.alt}
                      onChange={(e) =>
                        setPhotos((ps) => ps.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                    >
                      <Trash className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {photos.length < 6 &&
              (uploads.data?.enabled ? (
                <div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    multiple
                    className="sr-only"
                    id="photo-files"
                    onChange={(e) => void addFiles(e.target.files)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    busy={uploading}
                    icon={<UploadSimple className="size-4" />}
                    onClick={() => fileInput.current?.click()}
                  >
                    Upload photos
                  </Button>
                </div>
              ) : (
                <div className="grid gap-2">
                  <p className="text-[13px] text-ink-3">
                    Uploads need a Vercel Blob store on this project. Meanwhile, use a photo already on the shop, such
                    as /images/products/titanium-pot.jpg.
                  </p>
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      aria-label="Photo path on the shop"
                      placeholder="/images/products/..."
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!path.trim()) return;
                        setPhotos((p) => [...p, { url: path.trim(), alt: name }]);
                        setPath('');
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              ))}
            {photoError && <span className="text-[12.5px] text-danger">{photoError}</span>}
          </Panel>
        </div>

        <div className="grid content-start gap-5">
          <Panel title="Price and stock">
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Price
                <input name="price" inputMode="decimal" className={field('price')} placeholder="39.00" />
                {msg('price')}
              </label>
              <label className={label}>
                Old price (on sale)
                <input
                  name="compareAtPrice"
                  inputMode="decimal"
                  className={field('compareAtPrice')}
                  placeholder="None"
                />
                {msg('compareAtPrice')}
              </label>
              <label className={label}>
                Opening stock
                <input name="initialStock" inputMode="numeric" className={field('initialStock')} defaultValue="0" />
                {msg('initialStock')}
              </label>
              <label className={label}>
                Low stock at
                <input
                  name="lowStockThreshold"
                  inputMode="numeric"
                  className={field('lowStockThreshold')}
                  defaultValue="5"
                />
                {msg('lowStockThreshold')}
              </label>
            </div>
          </Panel>
          <Panel title="Shown in the shop">
            <fieldset className="grid gap-2 text-[14px]">
              <legend className="sr-only">Options</legend>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="active" defaultChecked /> Switched on (for sale)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="featured" /> Featured on the home page
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="returnable" defaultChecked /> Can be returned
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="sized" /> Has sizes (reviews ask about fit)
              </label>
            </fieldset>
          </Panel>
          {error && <FormAlert>{error}</FormAlert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => router.push('/products')}>
              Back
            </Button>
            <Button type="submit" busy={busy}>
              Add product
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
