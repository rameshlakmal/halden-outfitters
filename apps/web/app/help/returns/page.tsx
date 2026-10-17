import type { Metadata } from 'next';
import { Notice, PolicyPage, PolicySection } from '@/components/account/policy';

export const metadata: Metadata = { title: 'Returns' };

export default function ReturnsPage() {
  return (
    <PolicyPage
      title="Returns"
      intro="Changed your mind, or something arrived wrong? Here is how returns and refunds work."
    >
      <Notice>
        Returns open with orders in a later release of this preview. These are the rules they will follow.
      </Notice>

      <PolicySection title="The return window">
        <ul>
          <li>
            You can ask for a return within <strong>30 days of delivery</strong>, counting the delivery day.
          </li>
          <li>Orders delivered between 15 November and 31 December can be returned until 31 January.</li>
          <li>You can return some items of an order and keep the rest.</li>
        </ul>
      </PolicySection>

      <PolicySection title="Final-sale items">
        <p>
          For hygiene reasons some items can&apos;t be returned once delivered, such as water filters and pillows. Their
          product pages say so before you buy.
        </p>
      </PolicySection>

      <PolicySection title="Return shipping">
        <ul>
          <li>
            If the item is damaged, wrong or not as described, the return label is <strong>free</strong>.
          </li>
          <li>
            For any other reason, a <strong>$4.95</strong> label fee is taken off your refund.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="What you get back">
        <ul>
          <li>What you paid for the item, after its share of any coupon or points discount, plus its tax.</li>
          <li>
            Items that come back opened have a <strong>15% restocking fee</strong>, unless we were at fault.
          </li>
          <li>Items damaged by use are not refunded.</li>
          <li>Original shipping is refunded only when we were at fault and the whole order comes back.</li>
          <li>Refunds go back to your card, or as store credit if you prefer.</li>
        </ul>
      </PolicySection>
    </PolicyPage>
  );
}
