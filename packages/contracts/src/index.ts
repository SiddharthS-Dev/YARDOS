/**
 * @smartpark/contracts
 *
 * The shared domain vocabulary of SmartPark Enterprise. Both the API
 * (`@smartpark/api`) and the operations console (`@smartpark/web`) depend on
 * this package, which is what stops the two halves of the platform drifting
 * apart. Nothing in here may import from either app.
 */

export * from './enums';
export * from './errors';
export * from './state-machines';
export * from './permissions';
export * from './registration-number';
export * from './api';
