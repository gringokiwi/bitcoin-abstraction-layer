import {
  type bitcoin as bT,
  CoinSelectionStrategy,
} from '@atomicfinance/types';
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore
import coinselectFn from 'coinselect';
// @ts-ignore
import accumulativeFn from 'coinselect/accumulative';
// @ts-ignore
import blackjackFn from 'coinselect/blackjack';
// @ts-ignore
import breakFn from 'coinselect/break';
// @ts-ignore
import splitFn from 'coinselect/split';
/* eslint-enable @typescript-eslint/ban-ts-comment */

type CoinselectUtxo = {
  txid: string | Buffer;
  vout: number;
  value: number;
  nonWitnessUtxo?: Buffer;
  witnessUtxo?: {
    script: Buffer;
    value: number;
  };
};

type CoinselectOutput = {
  address: string;
  value?: number;
};

type CoinselectResult = {
  inputs?: CoinselectUtxo[];
  outputs?: CoinselectOutput[];
  fee: number;
};

type CoinselectFn = (
  utxos: CoinselectUtxo[],
  outputs: CoinselectOutput[],
  feeRate: number,
) => CoinselectResult;

/**
 * Convert bT.UTXO to CoinselectUtxo format
 */
export function toCoinselectUtxo(utxo: bT.UTXO): CoinselectUtxo {
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    value: utxo.value,
  };
}

/**
 * Convert CoinselectUtxo back to bT.UTXO format
 * Requires the original bT.UTXO to preserve address and derivationPath
 */
export function fromCoinselectUtxo(
  coinselectUtxos: CoinselectUtxo,
  originalUtxos: bT.UTXO[],
): bT.UTXO | undefined {
  // Find the original UTXO by matching txid and vout
  const txid =
    typeof coinselectUtxos.txid === 'string'
      ? coinselectUtxos.txid
      : coinselectUtxos.txid.toString('hex');
  return originalUtxos.find(
    (u) => u.txid === txid && u.vout === coinselectUtxos.vout,
  );
}

/**
 * Get the appropriate coinSelect function based on CoinSelectionStrategy
 */
export function getCoinselectFn(strategy: CoinSelectionStrategy): CoinselectFn {
  switch (strategy) {
    case CoinSelectionStrategy.COINSELECT:
      return coinselectFn;
    case CoinSelectionStrategy.ACCUMULATIVE:
      return accumulativeFn;
    case CoinSelectionStrategy.BLACKJACK:
      return blackjackFn;
    case CoinSelectionStrategy.SPLIT:
      return splitFn;
    case CoinSelectionStrategy.BREAK:
      return breakFn;
    default:
      return coinselectFn;
  }
}

/**
 * Use coinselect to select UTXOs based on the given strategy
 */
export function coinSelect(
  utxos: bT.UTXO[],
  collaterals: number[],
  feePerByte: number,
  strategy: CoinSelectionStrategy = CoinSelectionStrategy.COINSELECT,
): bT.UTXO[] {
  // If no UTXOs provided, return empty array
  if (utxos.length === 0) {
    return [];
  }

  // Get coinselect function based on strategy
  const coinselectFn = getCoinselectFn(strategy);

  // Convert bT.UTXO to CoinselectUtxo format
  const coinselectUtxos = utxos.map(toCoinselectUtxo);

  // Prepare outputs for coinselect
  const outputs: CoinselectOutput[] = collaterals.map((value) => ({
    // Output addresses are required (although ultimately skipped for fee calculation), so select a random input UTXO address
    address: utxos[Math.floor(Math.random() * utxos.length)].address,
    value,
  }));

  // Run coinselect
  const result = coinselectFn(coinselectUtxos, outputs, feePerByte);

  // If no inputs selected, return empty array
  if (!result.inputs || result.inputs.length === 0) {
    return [];
  }

  // Convert selected inputs back to bT.UTXO format
  const selectedUtxos: bT.UTXO[] = [];
  for (const input of result.inputs) {
    const originalUtxo = fromCoinselectUtxo(input, utxos);
    if (originalUtxo) {
      selectedUtxos.push(originalUtxo);
    } else {
      throw new Error(
        `Selected input UTXO not found in original UTXOs: txid=${input.txid}, vout=${input.vout}`,
      );
    }
  }

  // Return selected UTXOs
  return selectedUtxos;
}
