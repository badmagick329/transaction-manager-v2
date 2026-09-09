import { expect, test } from 'bun:test';
import { defaultUiPreferences } from './ui-preferences';
import { readUrlState, writeUrlState, transactionsForPeriod } from './url-state';

test('explicit transaction URLs clear unrelated saved filters', () => {
 const saved = defaultUiPreferences();
 saved.transactions.filters.description = 'old search';
 const next = readUrlState('?page=transactions&from=2024-02-01&to=2024-02-29&currency=GBP', saved);
 expect(next.transactions.filters.description).toBe('');
 expect(next.transactions.filters.minAmount).toBe('');
 expect(next.transactions.filters.endDate).toBe('2024-02-29');
 expect(readUrlState('', saved)).toBe(saved);
});
test('all transaction filters survive a shared URL', () => {
 const state = defaultUiPreferences(); state.page = 'transactions';
 state.transactions = { economicType: 'expense', completeDataOnly: true, showingCashFlowExclusions: true, filters: { sourceId: '1', accountId: '2', currencyCode: 'USD', transactionType: '', description: 'a & b', minAmount: '-50.25', maxAmount: '100', startDate: '2024-02-01', endDate: '2024-02-29', hideTransfers: true, hideTrading212InterestCashbackAndDividends: true, tagIds: ['3', '4'], untagged: true } };
 expect(readUrlState(writeUrlState(state), defaultUiPreferences()).transactions).toEqual(state.transactions);
});
test('custom dashboard range and yearly view survive URLs', () => {
 const state = defaultUiPreferences(); state.dashboard = { datePreset: 'custom', dateRange: { startDate: '2023-01-01', endDate: '2025-01-01' }, completeDataOnly: true, trendGranularity: 'year' };
 expect(readUrlState(writeUrlState(state), defaultUiPreferences()).dashboard).toEqual(state.dashboard);
});
test('invalid dates and amounts from URLs are discarded', () => {
 const state = readUrlState('?page=transactions&from=2024-02-30&min=bad&tag=x', defaultUiPreferences());
 expect(state.transactions.filters.startDate).toBe(''); expect(state.transactions.filters.minAmount).toBe(''); expect(state.transactions.filters.tagIds).toEqual([]);
});
test('period drill-down handles leap years and year boundaries', () => {
 expect(transactionsForPeriod('2024-02', 'GBP').filters.endDate).toBe('2024-02-29');
 expect(transactionsForPeriod('2025-12', 'USD').filters.endDate).toBe('2025-12-31');
 expect(transactionsForPeriod('2024', 'GBP').filters).toMatchObject({startDate: '2024-01-01', endDate: '2024-12-31', currencyCode: 'GBP', description: '', hideTransfers: false});
});
