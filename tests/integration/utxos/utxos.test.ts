import 'mocha';

import { bitcoin } from '@atomicfinance/types';
import { FundingInput } from '@node-dlc/messaging';
import { expect } from 'chai';

import Client from '../../../packages/client';
import {
  CoinSelectionStrategy,
  Input,
  InputSupplementationMode,
} from '../../../packages/types';
import { chains, fundAddress, getInput } from '../common';

const chain = chains.bitcoinWithJs;
const alice = chain.client;
const bob = chains.bitcoinWithDdk3.client;

describe('utxos', () => {
  describe('getUtxosForAmount', () => {
    it('should return input format correctly', async () => {
      const aliceInput = await getInputUsingGetInputsForAmount(alice);
      const input = aliceInput.inputs[0];
      expect(input.amount * 1e8).to.equal(input.value);
    });
  });

  describe('inputToFundingInput', () => {
    it('should convert between types', async () => {
      const actualInput: Input = await getInput(alice);
      const actualFundingInput: FundingInput = (await alice.dlc.inputToFundingInput(
        actualInput,
      )) as FundingInput;

      const input: Input = await alice.dlc.fundingInputToInput(
        actualFundingInput,
      );
      const fundingInput: FundingInput = (await alice.dlc.inputToFundingInput(
        input,
      )) as FundingInput;

      expect(actualInput.txid).to.equal(input.txid);
      expect(actualInput.vout).to.equal(input.vout);
      expect(actualInput.address).to.equal(input.address);
      expect(actualInput.amount).to.equal(input.amount);
      expect(actualInput.value).to.equal(input.value);
      expect(actualInput.derivationPath).to.equal(input.derivationPath);
      expect(actualInput.maxWitnessLength).to.equal(input.maxWitnessLength);
      expect(actualInput.redeemScript).to.equal(input.redeemScript);

      expect(actualFundingInput.inputSerialId).to.equal(
        fundingInput.inputSerialId,
      );
      expect(actualFundingInput.prevTx.serialize()).to.deep.equal(
        fundingInput.prevTx.serialize(),
      );
      expect(actualFundingInput.prevTxVout).to.equal(fundingInput.prevTxVout);
      expect(actualFundingInput.sequence.value).to.equal(
        fundingInput.sequence.value,
      );
      expect(actualFundingInput.maxWitnessLen).to.equal(
        fundingInput.maxWitnessLen,
      );
      expect(actualFundingInput.redeemScript).to.deep.equal(
        fundingInput.redeemScript,
      );
    });
  });
});

async function getInputUsingGetInputsForAmount(
  client: Client,
): Promise<InputsForAmountResponse> {
  const { address: unusedAddress } = await client.wallet.getUnusedAddress();

  await client.getMethod('jsonrpc')('importaddress', unusedAddress, '', false);

  await fundAddress(unusedAddress);

  const targets: bitcoin.OutputTarget[] = [
    {
      address: BurnAddress,
      value: 1 * 1e8,
    },
  ];

  const inputsForAmount: InputsForAmountResponse = client.getMethod(
    'getInputsForAmount',
  )(targets, 10, []);

  return inputsForAmount;
}

interface InputsForAmountResponse {
  inputs: Input[];
  change: Change;
  outputs: Output[];
  fee: number;
}

interface Change {
  value: number;
}

interface Output {
  value: number;
  id?: string;
}

const BurnAddress = 'bcrt1qxcjufgh2jarkp2qkx68azh08w9v5gah8u6es8s';

describe('GetInputsForAmountWithMode', () => {
  describe('Input Supplementation Modes', () => {
    describe('REQUIRED mode', () => {
      it('should successfully supplement minimal inputs when no fixed inputs provided', async () => {
        await getInput(bob);
        await getInput(bob);
        // Bob now has 2x2 BTC

        const targetAmount = BigInt(1 * 1e8); // Only need 1 BTC
        const feeRate = BigInt(10);

        const result: Input[] = await bob.getMethod(
          'GetInputsForAmountWithMode',
        )(
          [targetAmount],
          feeRate,
          [], // no fixed inputs supplied
          InputSupplementationMode.Required,
        );

        // Should select minimal inputs from wallet (not all 3)
        expect(result.length).to.equal(1);
      });

      it('should successfully supplement minimal inputs with fixed inputs provided', async () => {
        const fixedInput = await getInput(bob);
        // Bob now has 3x2 BTC

        const targetAmount = BigInt(3 * 1e8);
        const feeRate = BigInt(10);

        const result: Input[] = await bob.getMethod(
          'GetInputsForAmountWithMode',
        )(
          [targetAmount],
          feeRate,
          [fixedInput], // 2 BTC fixed, needs 1+ BTC more
          InputSupplementationMode.Required,
        );

        // Should supplement minimally (fixed + 1 more)
        expect(result.length).to.equal(2);

        // Verify fixed input is included
        const hasFixedInput = result.some(
          (input) =>
            input.txid === fixedInput.txid && input.vout === fixedInput.vout,
        );
        expect(hasFixedInput).to.be.true;
      });

      it('should throw error if supplemented inputs cannot cover required collateral', async () => {
        // Bob has 3x2 BTC from previous tests

        const targetAmount = BigInt(10 * 1e8); // Need 10 BTC (insufficient)
        const feeRate = BigInt(10);

        try {
          await bob.getMethod('GetInputsForAmountWithMode')(
            [targetAmount],
            feeRate,
            [], // no fixed inputs supplied
            InputSupplementationMode.Required,
          );
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error.message).to.include('Not enough balance');
        }
      });
    });

    describe('OPTIONAL mode', () => {
      it('should successfully supplement minimal inputs when balance is sufficient', async () => {
        const fixedInput = await getInput(bob);
        // Bob now has 4x2 BTC

        const targetAmount = BigInt(3 * 1e8); // Need 3 BTC total
        const feeRate = BigInt(10);

        const result: Input[] = await bob.getMethod(
          'GetInputsForAmountWithMode',
        )(
          [targetAmount],
          feeRate,
          [fixedInput], // 2 BTC fixed, needs 1+ BTC more
          InputSupplementationMode.Optional,
        );

        // Should supplement with minimal additional inputs
        expect(result.length).to.equal(2);

        // Verify fixed input is included
        const hasFixedInput = result.some(
          (input) =>
            input.txid === fixedInput.txid && input.vout === fixedInput.vout,
        );
        expect(hasFixedInput).to.be.true;
      });

      it('should fallback to fixed inputs when selection fails', async () => {
        const fixedInput = await getInput(bob);
        // Bob now has 5x2 BTC

        const targetAmount = BigInt(12 * 1e8); // Need 12 BTC (insufficient)
        const feeRate = BigInt(10);

        const result: Input[] = await bob.getMethod(
          'GetInputsForAmountWithMode',
        )(
          [targetAmount],
          feeRate,
          [fixedInput], // only 1 input supplied
          InputSupplementationMode.Optional,
        );

        // Should fall back to fixed inputs
        expect(result.length).to.equal(1);
        expect(result[0].txid).to.equal(fixedInput.txid);
      });
    });

    describe('None mode', () => {
      it('should perform coin selection on fixed inputs but not supplement from wallet', async () => {
        const fixedInput1 = await getInput(bob); // 2 BTC
        const fixedInput2 = await getInput(bob); // 2 BTC
        const fixedInput3 = await getInput(bob); // 2 BTC
        // Bob now has 8x2 BTC

        const targetAmount = BigInt(3 * 1e8); // Only need 3 BTC
        const feeRate = BigInt(10);

        const result: Input[] = await bob.getMethod(
          'GetInputsForAmountWithMode',
        )(
          [targetAmount],
          feeRate,
          [fixedInput1, fixedInput2, fixedInput3],
          InputSupplementationMode.None,
        );

        // None mode: YES coin selection (selects subset), NO supplementation (doesn't scan wallet)
        expect(result.length).to.equal(2); // Should select only 2 of the 3 fixed inputs

        // Verify selected inputs are from the fixed inputs
        result.forEach((selectedInput) => {
          const isFromFixed = [fixedInput1, fixedInput2, fixedInput3].some(
            (fixed) =>
              fixed.txid === selectedInput.txid &&
              fixed.vout === selectedInput.vout,
          );
          expect(isFromFixed).to.be.true;
        });
      });

      it('should fall back to fixed inputs when selection fails', async () => {
        const fixedInput = await getInput(bob);
        // Bob now has 9x2 BTC

        const targetAmount = BigInt(3 * 1e8); // Need 3 BTC
        const feeRate = BigInt(10);

        const result: Input[] = await bob.getMethod(
          'GetInputsForAmountWithMode',
        )([targetAmount], feeRate, [fixedInput], InputSupplementationMode.None);

        // Should fall back to fixed inputs
        expect(result.length).to.equal(1);
        expect(result[0].txid).to.equal(fixedInput.txid);
      });
    });
  });

  describe('Coin Selection Strategies', () => {
    describe('COINSELECT strategy', () => {
      it('should select minimum UTXOs needed for single amount', async () => {
        const targetAmount = BigInt(1 * 1e8); // 1 BTC
        const feeRate = BigInt(10);

        const result: Input[] = await bob.getMethod(
          'GetInputsForAmountWithMode',
        )(
          [targetAmount],
          feeRate,
          [],
          InputSupplementationMode.Required,
          CoinSelectionStrategy.COINSELECT,
        );

        // Should select minimum UTXOs needed
        expect(result.length).to.equal(1);

        // Should cover target amount
        const totalValue = result.reduce((sum, input) => sum + input.value, 0);
        expect(totalValue).to.be.greaterThan(Number(targetAmount));
      });

      it('should handle dual funding with two amounts', async () => {
        const amount1 = BigInt(1 * 1e8);
        const amount2 = BigInt(1.5 * 1e8);
        const feeRate = BigInt(10);

        const result: Input[] = await bob.getMethod(
          'GetInputsForAmountWithMode',
        )(
          [amount1, amount2],
          feeRate,
          [],
          InputSupplementationMode.Required,
          CoinSelectionStrategy.COINSELECT,
        );

        // Should cover combined value
        const totalValue = result.reduce((sum, input) => sum + input.value, 0);
        const totalRequired = Number(amount1 + amount2);
        expect(totalValue).to.be.greaterThan(totalRequired);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty amounts array', async () => {
      await getInput(bob);

      const result: Input[] = await bob.getMethod('GetInputsForAmountWithMode')(
        [],
        BigInt(10),
        [],
        InputSupplementationMode.Required,
        CoinSelectionStrategy.COINSELECT,
      );

      expect(result.length).to.equal(0);
    });

    it('should not select all UTXOs when only subset needed', async () => {
      const targetAmount = BigInt(1 * 1e8);
      const feeRate = BigInt(10);

      const result: Input[] = await bob.getMethod('GetInputsForAmountWithMode')(
        [targetAmount],
        feeRate,
        [],
        InputSupplementationMode.Required,
        CoinSelectionStrategy.COINSELECT,
      );

      // Should NOT select more than 1 UTXO
      expect(result.length).to.equal(1);
    });
  });
});
