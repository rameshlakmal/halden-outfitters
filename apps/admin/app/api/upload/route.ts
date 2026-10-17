// Product photo uploads, to Vercel Blob. The browser sends the file straight to Blob storage with a short-lived
// token from here (client upload, so no file passes through this function). A token is only given to a signed-in
// admin, asked of the API with the request's own session cookie, and only for images under products/.
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024;

/** Whether uploads are set up here (a Blob store connected to the project gives BLOB_READ_WRITE_TOKEN). */
export function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN) });
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'Photo uploads are not set up: connect a Vercel Blob store.' }, { status: 503 });
  }
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Only this site's own pages ask for upload tokens.
        const origin = request.headers.get('origin');
        if (origin && origin !== new URL(request.url).origin)
          throw new Error('Uploads must come from the admin itself.');
        const res = await fetch(`${API_URL}/api/v1/auth/session`, {
          headers: { cookie: request.headers.get('cookie') ?? '', accept: 'application/json' },
          cache: 'no-store',
        });
        const session = (await res.json().catch(() => null)) as { customer?: { role?: string } | null } | null;
        if (session?.customer?.role !== 'admin') throw new Error('Only admins can upload product photos.');
        if (!/^products\/[\w-]+\.(jpe?g|png|webp|avif)$/i.test(pathname))
          throw new Error('Name the photo products/<name>.jpg.');
        return { allowedContentTypes: IMAGE_TYPES, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'The upload was refused.' },
      { status: 400 },
    );
  }
}
