import type { Metadata } from 'next';
import { Notice, PolicyPage, PolicySection } from '@/components/account/policy';

export const metadata: Metadata = { title: 'Shipping' };

const ZONES = [
  { zone: 'Domestic', where: 'Our home country', standard: '7.95', express: '14.95', free: '75.00' },
  { zone: 'Europe', where: 'EU countries', standard: '14.95', express: '29.95', free: '150.00' },
  { zone: 'Rest of world', where: 'Everywhere else', standard: '24.95', express: 'Not offered', free: 'Not offered' },
];

export default function ShippingPage() {
  return (
    <PolicyPage title="Shipping" intro="What delivery costs, how tax works and when your card is charged.">
      <Notice>Checkout opens in the next release of this preview. These are the rules it will follow.</Notice>

      <PolicySection title="Rates by zone">
        <p>The zone comes from the country of your delivery address.</p>
        <div className="overflow-x-auto rounded-[16px] border border-line">
          <table className="w-full min-w-[520px] text-left text-[15px]">
            <thead className="bg-surface-2 text-sm text-ink">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Zone
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Standard
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Express
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Free standard from
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ZONES.map((z) => (
                <tr key={z.zone}>
                  <th scope="row" className="px-4 py-3 font-medium text-ink">
                    {z.zone}
                    <span className="block text-sm font-normal text-ink-3">{z.where}</span>
                  </th>
                  <td className="px-4 py-3 tabular-nums">{z.standard}</td>
                  <td className="px-4 py-3 tabular-nums">{z.express}</td>
                  <td className="px-4 py-3 tabular-nums">{z.free}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Free standard shipping counts what you pay for the goods <strong>after</strong> any coupon or points discount.
          A coupon can take an order under the threshold, and then shipping is charged.
        </p>
      </PolicySection>

      <PolicySection title="Tax">
        <ul>
          <li>
            Tax is a flat <strong>8%</strong> in every zone.
          </li>
          <li>It is charged on the goods after coupon and points discounts, not on shipping.</li>
          <li>It is rounded to the cent once per order.</li>
          <li>Each order keeps the rate it was charged, so a later change never alters an old order.</li>
        </ul>
      </PolicySection>

      <PolicySection title="When your card is charged">
        <p>
          At checkout we only <strong>reserve</strong> the amount on your card. We charge it when your order ships. If
          you cancel before then, the reservation is released and no money moves.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
