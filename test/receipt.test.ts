import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amount, check, type Copied } from '../src/receipt.ts';

test('amounts as printed become numbers', () => {
  assert.equal(amount('60.000'), 60000);
  assert.equal(amount('Rp 45,500'), 45500);
  assert.equal(amount('1.250.000'), 1250000);
  assert.equal(amount('12.50'), 12.5);
  assert.equal(amount('$1,234.56'), 1234.56);
  assert.equal(amount('1.234,56 €'), 1234.56);
  assert.equal(amount('-60.000'), -60000);
  assert.equal(amount('(5.00)'), -5);
  assert.equal(amount('7'), 7);
  assert.equal(amount('no money here'), null);
  assert.equal(amount(null), null);
});

const base: Copied = { merchant: 'Bakery Ana', date: null, currency: 'IDR', items: [], subtotal: null, discount: null,
  tax: null, service: null, total: null, paid: null, change: null };

test('a receipt whose figures agree is believed', () => {
  const r = check({ ...base, items: [{ name: 'Bread', qty: '2', amount: '40.000' }, { name: 'Tea', qty: '1', amount: '20.000' }],
    subtotal: '60.000', total: '60.000', paid: '100.000', change: '40.000' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.agreed, ['lines = subtotal', 'subtotal = total', 'lines = total', 'paid - change = total']);
});

test('tax may be included in the prices or added on top', () => {
  assert.equal(check({ ...base, subtotal: '60.000', tax: '5.455', total: '60.000' }).ok, true);
  assert.equal(check({ ...base, subtotal: '100.00', tax: '8.00', total: '108.00' }).ok, true);
});

test('a misread total is caught by the other figures', () => {
  const r = check({ ...base, items: [{ name: 'Bread', qty: '1', amount: '40.000' }], subtotal: '40.000', total: '46.000',
    paid: '50.000', change: '10.000' });
  assert.equal(r.ok, false);
  assert.match(r.issues.join(' '), /does not make the total/);
});

test('a receipt with nothing to cross-check is not believed', () => {
  assert.equal(check({ ...base, total: '60.000' }).ok, false);
  assert.equal(check({ ...base }).ok, false);
});

test('a total confirmed by cash and change stands even when the lines were misread', () => {
  const r = check({ ...base, items: [{ name: 'BAKSO', qty: '1', amount: '15.000' }, { name: 'GORENGAN', qty: '6', amount: '6.000' },
    { name: 'TL', qty: null, amount: '21.000' }, { name: 'CG', qty: null, amount: '9.000' }], subtotal: '15.000', discount: '6.000',
    total: '21.000', paid: '30.000', change: '9.000' });
  assert.equal(r.ok, true);
  assert.ok(r.agreed.includes('paid - change = total'));
  assert.ok(r.issues.length > 0);
});

test('a line printed as unit price times quantity adds up', () => {
  const r = check({ ...base, items: [{ name: 'TICKET CP', qty: '4', amount: '60.000' }], total: '240.000' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.agreed, ['lines = total']);
});
