import React, { useEffect } from 'react';
import { useAccount, useSendTransaction } from 'wagmi';
import { useCall } from 'wagmi'
import { useState } from 'react';
import { IValidator } from './SubmitConsolidationsFormProps';
import { toReadableAmount } from '../../utils/ReadableAmount';
import { Modal } from 'react-bootstrap';

interface IConsolidationReviewProps {
  sourceValidator: IValidator;
  targetValidator: IValidator;
  consolidationContract: string;
  explorerUrl: string;
}

const ConsolidationReview = (props: IConsolidationReviewProps) => {
  const { address, chain } = useAccount();
  const [addExtraFee, setAddExtraFee] = useState(true);
  const [errorModal, setErrorModal] = useState<string | null>(null);

  const consolidationQueueLengthCall = useCall({
    account: address,
    to: props.consolidationContract,
    data: "0x",
		chain: chain,
	});
  const submitRequest = useSendTransaction();

  useEffect(() => {
    const interval = setInterval(() => {
      consolidationQueueLengthCall.refetch();
    }, 15000);
    return () => {
      clearInterval(interval);
    };
  }, [consolidationQueueLengthCall]);

  let queueLength = 0n;
  let isPreElectra = false;
  let requiredFee = 0n;
  let requestFee = 0n;
  let failedQueueLength = false;
  if (consolidationQueueLengthCall.isFetched && consolidationQueueLengthCall.data) {
    var queueLenHex = consolidationQueueLengthCall.data.data as string;
    if (!queueLenHex) {
      failedQueueLength = true;
    } else if (queueLenHex == "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") {
      isPreElectra = true;
    } else {
      queueLength = BigInt(queueLenHex);
      requiredFee = getRequiredFee(queueLength);

      if(addExtraFee) {
        requestFee = getRequiredFee(queueLength + 10n); // add extra fee for 10 consolidations submitted before this
      } else {
        requestFee = requiredFee;
      }
    }
  }

  var feeFactor = 0;
  var feeUnit = "Wei";

  if (requestFee > 100000000000000n) {
    feeFactor = 18;
    feeUnit = "ETH";
  } else if (requestFee > 100000n) {
    feeFactor = 9;
    feeUnit = "Gwei";
  }

  return (
    <div>
      {consolidationQueueLengthCall.isError ?
        <div className="alert alert-danger" role="alert">
          Error loading queue length from consolidation contract. <br />
          {consolidationQueueLengthCall.error?.message} <br />
          <button className="btn btn-primary mt-2" onClick={() => consolidationQueueLengthCall.refetch()}>
            Retry
          </button>
        </div>
      : failedQueueLength ?
        <div className="alert alert-danger" role="alert">
          Error loading queue length from consolidation contract. (check contract address: {props.consolidationContract})
        </div>
      : !consolidationQueueLengthCall.isFetched ?
        <p>Loading...</p>
      : isPreElectra ?
        <div className="alert alert-danger" role="alert">
          The network is not on Electra yet, so consolidation requests can not be submitted.
        </div>
      : <div>
          <div className="row">
            <div className="col-3 col-lg-2">
              Consolidation Contract:
            </div>
            <div className="col-9 col-lg-10">
              {props.consolidationContract}
            </div>
          </div>
          <div className="row">
            <div className="col-3 col-lg-2">
              Consolidation Queue:
            </div>
            <div className="col-9 col-lg-10">
              {queueLength.toString()} Consolidations
            </div>
          </div>
          <div className="row">
            <div className="col-3 col-lg-2">
              Required queue fee:
            </div>
            <div className="col-9 col-lg-10">
              {toReadableAmount(requiredFee, feeFactor, feeUnit, 4)}
            </div>
          </div>
          <div className="row">
            <div className="col-3 col-lg-2">
              Add extra fee:
            </div>
            <div className="col-9 col-lg-10">
              <input type="checkbox" className="form-check-input" id="addExtraFee" checked={addExtraFee} onChange={(e) => setAddExtraFee(e.target.checked)} />
              <label htmlFor="addExtraFee" className="ms-1">Add extra fee to avoid rejection due to other submissions</label>
            </div>
          </div>
          <div className="row">
            <div className="col-3 col-lg-2">
              Total fee:
            </div>
            <div className="col-9 col-lg-10">
              {toReadableAmount(requestFee, feeFactor, feeUnit, 4)}
            </div>
          </div>
          <div className="row mt-3">
            <div className="col-12">
              <button className="btn btn-primary" disabled={submitRequest.isPending || submitRequest.isSuccess} onClick={() => submitConsolidation()}>
                {submitRequest.isSuccess ?
                  <span>Submitted</span> :
                  submitRequest.isPending ? (
                    <span className="text-nowrap"><div className="spinner-border spinner-border-sm me-1" role="status"></div>Pending...</span>
                    ) : (
                      submitRequest.isError ? (
                        <span className="text-nowrap"><i className="fa-solid fa-repeat me-1"></i> Retry consolidation</span>
                      ) : (
                        "Submit consolidation request"
                      )
                    )
                }
              </button>
            </div>
          </div>
          {submitRequest.isSuccess ?
            <div className="row mt-3">
              <div className="col-12">
                <div className="alert alert-success">
                  Consolidation TX: 
                  {props.explorerUrl ?
                    <a className="ms-1" href={props.explorerUrl + "tx/" + submitRequest.data} target="_blank" rel="noreferrer">{submitRequest.data}</a>
                  : <span className="ms-1">{submitRequest.data}</span>
                  }
                </div>
              </div>
            </div>
          : null}
        </div>
        }
        {errorModal && (
          <Modal show={true} onHide={() => setErrorModal(null)} size="lg">
            <Modal.Header closeButton>
              <Modal.Title>Consolidation Transaction Failed</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <pre className="m-0">{errorModal}</pre>
            </Modal.Body>
            <Modal.Footer>
              <button className="btn btn-primary" onClick={() => setErrorModal(null)}>Close</button>
            </Modal.Footer>
          </Modal>
        )}
    </div>
  );

  function getRequiredFee(numerator: bigint): bigint {
    // https://eips.ethereum.org/EIPS/eip-7251#fee-calculation
    let i = 1n;
    let output = 0n;
    let numeratorAccum = 1n * 17n; // factor * denominator

    while (numeratorAccum > 0n) {
        output += numeratorAccum;
        numeratorAccum = (numeratorAccum * numerator) / (17n * i);
        i += 1n;
    }

    return output / 17n;
  }

  function submitConsolidation() {
    submitRequest.sendTransactionAsync({
      to: props.consolidationContract,
      account: address,
      chainId: chain?.id,
      value: requestFee,
      // https://eips.ethereum.org/EIPS/eip-7251#add-consolidation-request
      // calldata (96 bytes): sourceValidator.pubkey (48 bytes) + targetValidator.pubkey (48 bytes)
      data: "0x" + props.sourceValidator.pubkey.substring(2) + props.targetValidator.pubkey.substring(2),
    }).then(tx => {
      console.log(tx);
    }).catch(error => {
      setErrorModal(error.message);
    });

  }

};

export default ConsolidationReview;
