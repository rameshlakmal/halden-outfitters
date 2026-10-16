import { Compass } from '@phosphor-icons/react/dist/ssr';
import { LinkButton } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-xl justify-items-center gap-4 px-4 py-28 text-center">
      <Compass className="size-14 text-brand" weight="thin" />
      <h1 className="text-4xl font-semibold tracking-tight">Off the map</h1>
      <p className="text-lg text-ink-2">That page doesn't exist, or it has moved. The trail back starts here.</p>
      <div className="mt-2 flex gap-3">
        <LinkButton href="/">Home</LinkButton>
        <LinkButton href="/shop" variant="outline">
          Browse the shop
        </LinkButton>
      </div>
    </div>
  );
}
