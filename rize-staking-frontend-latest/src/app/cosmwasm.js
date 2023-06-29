import { useState, useEffect, createContext, useContext } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import {
  CosmWasmClient,
  SigningCosmWasmClient,
} from "@cosmjs/cosmwasm-stargate";
import { defaultRegistryTypes, SigningStargateClient } from "@cosmjs/stargate";
import { encodePubkey, makeSignDoc, Registry } from "@cosmjs/proto-signing";
import { encodeSecp256k1Pubkey } from "@cosmjs/amino/build/encoding";
import { fromBase64, toBase64 } from "@cosmjs/encoding";
import { makeSignDoc as AminoMakeSignDoc } from "@cosmjs/amino";
import { AuthInfo, TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { MsgTransfer } from "cosmjs-types/ibc/applications/transfer/v1/tx";
import { config, chainConfig } from "./config.js";
import { isEmpty } from "app/methods";
import { QueryClient } from "react-query";
import { coins } from "@cosmjs/stargate";
import {
  convertDenomToMicroDenom,
  convertMicroDenomToDenom,
} from "utils/utils";

const SALE_TYPE = {
  Fixed: 0,
  Auction: 1,
};

const APY_OPTION = {
  2592000: 1000,
  5184000: 2000,
  7776000: 3500,
  10368000: 5000,
  15552000: 6500,
  20736000: 9000,
  31104000: 14800,
  62208000: 18000
}

const MULTIPLE = 10000;
const ONE_YEAR_SECONDS = 31536000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
    },
  },
});

const chainInfoQueryKey = "@chain-info";

const unsafelyReadChainInfoCache = () =>
  queryClient.getQueryCache().find(chainInfoQueryKey)?.state?.data;

const getDefaultExecuteFee = (feeCurrency) => ({
  amount: coins(500000, feeCurrency[0].coinDenom),
  gas: "500000",
});

const unsafelyGetDefaultExecuteFee = () => {
  /* hack: read chain info from query cache */
  const chainInfo = unsafelyReadChainInfoCache();

  /* throw an error if the function was called before the cache is available */
  if (!chainInfo) {
    throw new Error(
      "No chain info was presented in the cache. Seem to be an architectural issue. Contact developers."
    );
  }

  return getDefaultExecuteFee(chainInfo.feeCurrencies);
};

async function getKeplr() {
  if (window.keplr) {
    return window.keplr;
  }

  if (document.readyState === "complete") {
    return window.keplr;
  }

  return new Promise((resolve) => {
    const documentStateChange = (event) => {
      if (event.target && event.target.readyState === "complete") {
        resolve(window.keplr);
        document.removeEventListener("readystatechange", documentStateChange);
      }
    };

    document.addEventListener("readystatechange", documentStateChange);
  });
}

const defaultFee = {
  amount: [],
  gas: "1000000",
};

const CosmwasmContext = createContext({});
export const useSigningClient = () => useContext(CosmwasmContext);

export const SigningCosmWasmProvider = ({ children }) => {
  const [client, setClient] = useState(null);
  const [signingClient, setSigningClient] = useState(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [balances, setBalances] = useState({});
  const [stakingInfo, setStakingInfo] = useState([]);

  const MARKETPLACE = config.MARKETPLACE;
  const CW20_CONTRACT = config.CW20_CONTRACT;
  const RIZE_STAKING_CONTRACT = config.RIZE_STAKING_CONTRACT;

  useEffect(() => {
    fetchBalance();
  }, [walletAddress]);

  const loadClient = async (rpc = "") => {
    try {
      const temp = await CosmWasmClient.connect(config.RPC_URL);
      setClient(temp);
    } catch (error) {
      throw error;
    }
  };

  const connectWallet = async (new_config = null) => {
    const keplr = await getKeplr();
    let walletConfig = chainConfig;
    if (!isEmpty(new_config)) {
      walletConfig = new_config;
    }

    if (!window.getOfflineSigner || !window.keplr || !keplr) {
      alert("Please install keplr to continue.");
      window.open("https://www.keplr.app/", "_blank");
      return;
    } else {
      if (window.keplr.experimentalSuggestChain) {
        try {
          await window.keplr.experimentalSuggestChain(walletConfig);
        } catch (error) {
          console.log(error);
          toast.error("Failed to suggest the chain");
          return;
        }
      } else {
        toast.warn("Please use the recent version of keplr extension");
        return;
      }
    }

    try {
      await keplr.enable(walletConfig.chainId);
    } catch (err) {
      console.log(err);
      return;
    }

    try {
      const offlineSigner = await window.keplr.getOfflineSigner(
        walletConfig.chainId
      );
      const tempClient = await SigningCosmWasmClient.connectWithSigner(
        walletConfig.rpc,
        offlineSigner
      );
      setSigningClient(tempClient);

      const accounts = await offlineSigner.getAccounts();
      const address = accounts[0].address;
      setWalletAddress(address);
      localStorage.setItem("address", address);
    } catch (err) {
      console.log("Connect Wallet: ", err);
      return;
    }
  };

  const disconnect = () => {
    if (signingClient) {
      localStorage.removeItem("address");
      signingClient.disconnect();
    }
    setWalletAddress("");
    setSigningClient(null);
  };

  const calc_reward = (stakingInfos, reward_interval) => {
    let totalReward = 0;
    stakingInfos.map((record) => {
      let staked_time = Math.floor(new Date().getTime() / 1000) - record.last_time;
      console.log(staked_time, "------------------------------------------", APY_OPTION[record.lock_type])
      let per_reward = 0;
      if (staked_time < record.lock_type) {
        per_reward = 0;
      } else {
        per_reward = convertDenomToMicroDenom(record.amount) * APY_OPTION[record.lock_type] / MULTIPLE;
        per_reward = per_reward * reward_interval / ONE_YEAR_SECONDS;
        per_reward = per_reward * staked_time / reward_interval;
        totalReward += per_reward;
      }
    })
    console.log("[total reward] -------------------------------> ", totalReward);
    return convertMicroDenomToDenom(totalReward);
  }

  const fetchBalance = async () => {
    try {
      console.log(" Fetch balance ", walletAddress);
      if (!walletAddress) return;
      const balanceList = {};
      const resp = await axios({
        method: "get",
        url: `${config.REST_URL}/bank/balances/${walletAddress}`,
        headers: {
          Accept: "application/json, text/plain, */*",
        },
      });
      const result = resp.data.result;
      for (let i = 0; i < result.length; i++) {
        balanceList[result[i].denom] = convertMicroDenomToDenom(
          result[i].amount
        );
      }
      if (client) {
        // rize token balance
        const resp2 = await client.queryContractSmart(config.CW20_CONTRACT, {
          balance: { address: walletAddress },
        });
        balanceList.cw20 = convertMicroDenomToDenom(resp2.balance);
        // staking info
        const resp3 = await client.queryContractSmart(RIZE_STAKING_CONTRACT, {
          staker: { address: walletAddress },
        });
        console.log("staking info -----------------------------------> ", resp3);
        // config info
        const resp4 = await client.queryContractSmart(RIZE_STAKING_CONTRACT, {
          config: {},
        });
        console.log("contract config -----------------------------------> ", resp4);
        // calculate total reward and locked amount
        if (resp3.length > 0) {
          let lockedAmount = 0;
          // updated staking info (string -> number)
          const updatedResp3 = resp3.map((record) => {
            const updatedRecord = {...record};
            updatedRecord.amount = convertMicroDenomToDenom(updatedRecord.amount);
            
            const staked_time = Math.floor(new Date().getTime() / 1000) - record.last_time;
            console.log(staked_time, "------------------------------------------", APY_OPTION[record.lock_type])
            updatedRecord.canUnlock = (staked_time < record.lock_type) ? false : true
            updatedRecord.staked_time = staked_time;
            
            lockedAmount += updatedRecord.amount;
            return updatedRecord;
          });
          console.log("locked amount -------------------------------------------> ", lockedAmount);
          console.log("updated staking info -----------------------------------> ", updatedResp3);
          balanceList.reward = calc_reward(updatedResp3, resp4.reward_interval);
          balanceList.locked = lockedAmount;
          setStakingInfo(updatedResp3);
        }
        
      }
      console.log(">>>> Balance <<<<", balanceList);
      setBalances(balanceList);
    } catch (error) {
      console.log("Blance error 2: ", error);
    }
  };

  console.log(balances);
  
  const getTokenBalance = async (address) => {
    try {
      const resp = await signingClient.queryContractSmart(
        config.CW20_CONTRACT,
        {
          balance: {
            address: address,
          },
        }
      );
      setBalances({
        ...balances,
        cw20: convertMicroDenomToDenom(resp.balance),
      });
    } catch (err) {
      console.log(err);
    }
  };

  const getConfig = async () => {
    if (!client) return;
    try {
      const result = await client.queryContractSmart(MARKETPLACE, {
        config: {},
      });
      return result;
    } catch (err) {
      console.log(err);
    }
  };

  const getOwnedCollections = async (address) => {
    if (!client) return;
    try {
      const result = await client.queryContractSmart(MARKETPLACE, {
        owned_collections: { owner: address },
      });
      return result;
    } catch (err) {
      console.log(err);
    }
  };

  const listCollections = async () => {
    if (!client) return;
    try {
      const result = await client.queryContractSmart(MARKETPLACE, {
        list_collections: {},
      });
      return result;
    } catch (err) {
      console.log(err);
    }
  };

  const collectionConfig = async (address) => {
    if (!client) return;
    try {
      const result = await client.queryContractSmart(address, {
        get_config: {},
      });
      return result;
    } catch (err) {
      console.log(err);
    }
  };

  const collection = async (id) => {
    if (!client) return;
    try {
      const result = await client.queryContractSmart(MARKETPLACE, {
        collection: { id: parseInt(id) },
      });
      return result;
    } catch (err) {
      console.log(err);
    }
  };

  const numOffers = async () => {
    if (!client) return;
    try {
      const result = await client.queryContractSmart(MARKETPLACE, {
        get_count: {},
      });
      return result.count;
    } catch (err) {
      console.log(err);
    }
  };

  const addCollection = async (
    owner,
    maxTokens,
    name,
    symbol,
    tokenCodeId,
    maximumRoyaltyFee,
    royalties,
    uri
  ) => {
    try {
      if (!signingClient) return -1;
      const result = await signingClient.execute(
        owner,
        MARKETPLACE,
        {
          add_collection: {
            owner: owner,
            max_tokens: maxTokens,
            name: name,
            symbol: symbol,
            token_code_id: tokenCodeId,
            maximum_royalty_fee: maximumRoyaltyFee,
            royalties: royalties,
            uri: uri,
          },
        },
        defaultFee,
        undefined,
        []
      );
      return result.transactionHash;
    } catch (error) {
      throw error;
    }
  };

  const removeCollection = async (owner, id) => {
    try {
      if (!signingClient) return -1;
      const result = await signingClient.execute(
        owner,
        MARKETPLACE,
        {
          remove_collection: {
            id,
          },
        },
        defaultFee,
        undefined,
        []
      );
      return result.transactionHash;
    } catch (error) {
      throw error;
    }
  };

  const batchMint = async (sender, collectionContract, uris, names) => {
    if (!signingClient) return -1;
    try {
      let owners = [];
      for (let idx = 0; idx < uris.length; idx++) owners.push(sender);
      const extension = [];
      names.map((name) => {
        extension.push({
          name,
        });
      });
      const result = await signingClient.execute(
        sender,
        collectionContract,
        { batch_mint: { uri: uris, owner: owners, extension } },
        defaultFee
      );
      return result.transactionHash;
    } catch (error) {
      throw error;
    }
  };

  const mintNFT = async (sender, collectionContract, name, uri) => {
    if (!signingClient) return -1;
    try {
      const result = await signingClient.execute(
        sender,
        collectionContract,
        {
          mint: {
            uri: uri,
            name: name,
          },
        },
        defaultFee
      );
      return result.transactionHash;
    } catch (error) {
      throw error;
    }
  };

  const burnNFT = async (sender, cw721Address, token_id) => {
    if (!signingClient) return -1;
    try {
      const result = await signingClient.execute(
        sender,
        cw721Address,
        {
          burn: {
            token_id,
          },
        },
        defaultFee
      );
      return result.transactionHash;
    } catch (error) {
      throw error;
    }
  };

  const listNFT = async (
    sender,
    cw721Address,
    sale_type,
    duration_type,
    initial_price,
    reserve_price,
    denom,
    tokenId,
    targetContract
  ) => {
    try {
      if (!signingClient) return -1;
      initial_price = convertDenomToMicroDenom(initial_price);
      reserve_price = initial_price;
      const msg = {
        start_sale: {
          sale_type,
          duration_type,
          initial_price,
          reserve_price,
          denom: { cw20: config.CW20_CONTRACT },
        },
      };
      console.log(
        ">>>>>>>>> ",
        sender,
        cw721Address,
        tokenId,
        targetContract,
        msg
      );
      const result = await signingClient.execute(
        sender,
        cw721Address,
        {
          send_nft: {
            contract: targetContract,
            token_id: tokenId.toString(),
            msg: btoa(JSON.stringify(msg)),
          },
        },
        defaultFee,
        undefined
      );
      return result.transactionHash;
    } catch (error) {
      console.log(error);
      throw error;
    }
  };

  const sendToken = async (sender, amount, token_id, collectionAddr) => {
    try {
      if (!signingClient) return -1;
      const msg = { propose: { token_id } };
      console.log(
        "sendToken () ===> ",
        sender,
        CW20_CONTRACT,
        collectionAddr,
        convertDenomToMicroDenom(amount),
        msg
      );
      const result = await signingClient.execute(
        sender,
        CW20_CONTRACT,
        {
          send: {
            contract: collectionAddr,
            amount: convertDenomToMicroDenom(amount),
            msg: btoa(JSON.stringify(msg)),
          },
        },
        defaultFee,
        undefined
      );
      return result.transactionHash;
    } catch (error) {
      console.log(">>>>", error);
      throw error;
    }
  };

  const buyNowNFT = async (sender, collectionContract, token_id, denom) => {
    if (!signingClient) return -1;
    try {
      const result = await signingClient.execute(
        sender,
        collectionContract,
        {
          propose: {
            token_id,
            denom,
          },
        },
        defaultFee,
        undefined
      );
      return result.transactionHash;
    } catch (error) {
      throw error;
    }
  };

  const updateNFT = async (
    sender,
    collectionContract,
    token_id,
    sale_type,
    duration_type,
    initial_price,
    reserve_price,
    denom
  ) => {
    if (!signingClient) return -1;
    try {
      initial_price = convertDenomToMicroDenom(initial_price);
      reserve_price = initial_price;
      console.log(
        "updateNFT () ===> ",
        sender,
        collectionContract,
        token_id,
        sale_type,
        duration_type,
        initial_price,
        reserve_price,
        denom
      );
      const result = await signingClient.execute(
        sender,
        collectionContract,
        {
          edit_sale: {
            token_id,
            sale_type,
            duration_type,
            initial_price,
            reserve_price,
            denom,
          },
        },
        defaultFee,
        undefined
      );
      return result.transactionHash;
    } catch (error) {
      throw error;
    }
  };
  const acceptSaleNFT = async (sender, collectionContract, token_id) => {
    if (!signingClient) return -1;
    try {
      const result = await signingClient.execute(
        sender,
        collectionContract,
        {
          accept_sale: {
            token_id,
          },
        },
        defaultFee,
        undefined
      );
      return result.transactionHash;
    } catch (error) {
      throw error;
    }
  };

  const cancelSaleNFT = async (sender, collectionContract, token_id) => {
    if (!signingClient) return -1;
    try {
      const result = await signingClient.execute(
        sender,
        collectionContract,
        {
          cancel_sale: {
            token_id,
          },
        },
        defaultFee,
        undefined
      );
      return result.transactionHash;
    } catch (error) {
      throw error;
    }
  };

  const transferNFT = async (sender, cw721Address, recipient, token_id) => {
    if (!signingClient) return -1;
    try {
      const result = await signingClient.execute(
        sender,
        cw721Address,
        {
          transfer_nft: {
            recipient,
            token_id,
          },
        },
        defaultFee,
        undefined
      );
      return result.transactionHash;
    } catch (error) {
      throw error;
    }
  };

  const executeStake = async (stakingAmount, apyIndex) => {
    console.log(stakingAmount, "*******************", apyIndex)
    let result;
    try {
      let encodedMsg = toBase64(new TextEncoder().encode(`{"stake": { "lock_type": ${apyIndex} }}`))
      result = await signingClient?.execute(
        walletAddress, // sender address
        CW20_CONTRACT,
        {
          "send":
          {
            "contract": RIZE_STAKING_CONTRACT,
            "amount": convertDenomToMicroDenom(stakingAmount),
            "msg": encodedMsg
          }
        }, // msg
        defaultFee,
        undefined,
        []
      )
      await fetchBalance();
      if (result && result.transactionHash) {
        console.log("Staking Tx successful ==============> ", result.transactionHash)
        toast.success("Staked successfully!");
      }
    } catch (error) {
      console.log("staking error : ", error.message);
      toast.error("Staking failed!");
    }
  }

  const executeReward = async () => {
    let result;
    try {
      result = await signingClient?.execute(
        walletAddress, // sender address
        RIZE_STAKING_CONTRACT,
        {
          "claim_reward": {}
        },
        defaultFee,
        undefined,
        []
      )
      await fetchBalance();
      if (result && result.transactionHash) {
        console.log("Claim Tx successful ==============> ", result.transactionHash)
        toast.success("Claimed successfully!");
      }
    } catch (error) {
      console.log("Claim error : ", error.message);
      toast.error("Reward Claim failed!");
    }
  }

  const executeUnstake = async (index, unstakingAmount) => {
    console.log(index, "^^^^^^^^^^^^^^^^^^^^^^^^^^^", unstakingAmount)
    let result;
    try {
      result = await signingClient?.execute(
        walletAddress, // sender address
        RIZE_STAKING_CONTRACT,
        {
          "unstake": {
            "index": index,
            "amount": convertDenomToMicroDenom(unstakingAmount)
          }
        },
        defaultFee,
        undefined,
        []
      )
      await fetchBalance();
      if (result && result.transactionHash) {
        console.log("Unstake Tx successful ==============> ", result.transactionHash)
        toast.success("Unstaked successfully!");
      }
    } catch (error) {
      console.log("Unstake error : ", error.message);
      toast.error("Unstaking failed!");
    }
  }

  return (
    <CosmwasmContext.Provider
      value={{
        walletAddress,
        client,
        balances,
        signingClient,
        stakingInfo,
        loadClient,
        connectWallet,
        disconnect,
        fetchBalance,
        getTokenBalance,
        getConfig,
        getOwnedCollections,
        listCollections,
        collection,
        removeCollection,
        numOffers,
        addCollection,
        mintNFT,
        burnNFT,
        listNFT,
        sendToken,
        buyNowNFT,
        acceptSaleNFT,
        cancelSaleNFT,
        transferNFT,
        updateNFT,
        collectionConfig,
        batchMint,
        executeStake,
        executeReward,
        executeUnstake,
      }}
    >
      {children}
    </CosmwasmContext.Provider>
  );
};
