use crate::constants::{self};
use crate::error::ContractError;
use crate::msg::{
    ConfigResponse, ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg, ReceiveMsg, StakerInfo, StakerListResponse, TestBalanceResponse,
    Token1ForToken2PriceResponse, Token2ForToken1PriceResponse,
};
use crate::state::{Config, CONFIG, RANKS, RANK_STAKERS, STAKERS};
use crate::util;
#[cfg(not(feature = "library"))]
use cosmwasm_std::entry_point;
use cosmwasm_std::{
    attr, from_binary, to_binary, Addr, Binary, CosmosMsg, Deps, DepsMut, Env, MessageInfo, Order,
    QueryRequest, Response, StdResult, Storage, Uint128, WasmMsg, WasmQuery,
};
use cw2::{get_contract_version, set_contract_version};
use cw20::{
    BalanceResponse as CW20BalanceResponse, Cw20ExecuteMsg, Cw20QueryMsg, Cw20ReceiveMsg, Denom,
    TokenInfoResponse,
};
use cw_storage_plus::Bound;
use cw_utils::maybe_addr;

// Version info, for migration info
const CONTRACT_NAME: &str = "rize-staking";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

const MULTIPLE: u128 = 10000u128;
///////////////////////////////////////////////////////// this func is called for instantiating the contract //////////////////////////////////
///
///         input params: owner address
///                       stake token address
///                       reward token address
///                       reward interval
///                       charity wallet address for reward
///                       burn wallet address for reward
///                       artists wallet address for reward
///
///         
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> StdResult<Response> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let config = Config {
        owner: info.sender.clone(),
        rize_token_address: msg.rize_token_address,
        reward_amount: Uint128::zero(),
        stake_amount: Uint128::zero(),
        reward_interval: msg.reward_interval,
        enabled: true,
    };
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::default())
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::UpdateOwner { owner } => execute_update_owner(deps, info, owner),
        ExecuteMsg::UpdateEnabled { enabled } => execute_update_enabled(deps, info, enabled),
        ExecuteMsg::UpdateConstants { rize_token_address, reward_interval } => {
            execute_update_constants(deps, info, rize_token_address, reward_interval)
        }
        ExecuteMsg::Receive(msg) => execute_receive(deps, env, info, msg),
        ExecuteMsg::WithdrawReward { amount } => execute_withdraw_reward(deps, env, info, amount),
        ExecuteMsg::WithdrawStake { amount } => execute_withdraw_stake(deps, env, info, amount),
        ExecuteMsg::ClaimReward { } => {
            execute_claim_reward(deps, env, info)
        }
        ExecuteMsg::Unstake { index, amount } => execute_unstake(deps, env, info, index, amount),
    }
}
///////////////////////////////////////////////////////// this func is called when user click stake button on the frontend //////////////////////////////////
///
///         input params: customer's wallet address
///                       lock_type for claim reward
///         
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
pub fn execute_receive(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    wrapper: Cw20ReceiveMsg,
) -> Result<Response, ContractError> {
    check_enabled(&deps, &info)?;
    let mut cfg = CONFIG.load(deps.storage)?;

    if wrapper.amount == Uint128::zero() {
        return Err(ContractError::InvalidInput {});
    }
    let user_addr = &deps.api.addr_validate(&wrapper.sender)?;

    if info.sender.clone() != cfg.rize_token_address {
        return Err(ContractError::UnacceptableToken {});
    }

    let msg: ReceiveMsg = from_binary(&wrapper.msg)?;
    match msg {
        ReceiveMsg::Stake { lock_type } => {
            let mut list = STAKERS
                .load(deps.storage, user_addr.clone())
                .unwrap_or(vec![]);
            list.push(StakerInfo {
                address: user_addr.clone(),
                amount: wrapper.amount,
                reward: Uint128::zero(),
                last_time: env.block.time.seconds(),
                lock_type: match lock_type {
                    0 => constants::DAYS_30_SECONDS,
                    1 => constants::DAYS_60_SECONDS,
                    2 => constants::DAYS_90_SECONDS,
                    3 => constants::DAYS_120_SECONDS,
                    4 => constants::DAYS_180_SECONDS,
                    5 => constants::DAYS_240_SECONDS,
                    6 => constants::DAYS_360_SECONDS,
                    _ => constants::DAYS_720_SECONDS,
                },
            });
            STAKERS.save(deps.storage, user_addr.clone(), &list)?;

            cfg.stake_amount = cfg.stake_amount + wrapper.amount;
            CONFIG.save(deps.storage, &cfg)?;

            return Ok(Response::new().add_attributes(vec![
                attr("action", "stake"),
                attr("address", user_addr.clone()),
                attr("amount", wrapper.amount),
            ]));
        },
        ReceiveMsg::DepositReward { } => {
            //Just receive in contract cache and update config
            cfg.reward_amount = cfg.reward_amount + wrapper.amount;
            CONFIG.save(deps.storage, &cfg)?;

            return Ok(Response::new()
            .add_attributes(vec![
                attr("action", "deposit_reward"),
                attr("address", user_addr),
                attr("amount", wrapper.amount),
            ]));
        }
    }
}
///////////////////////////////////////////////////////// this func is called for calculating the reward amount  //////////////////////////////////
///
///         
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
pub fn update_reward(
    storage: &mut dyn Storage,
    env: Env,
    address: Addr,
) -> Result<Uint128, ContractError> {
    let mut exists = STAKERS.load(storage, address.clone()).unwrap_or(vec![]);
    let cfg = CONFIG.load(storage)?;
    let mut total_reward = Uint128::zero();

    for i in 0..exists.len() {
        let staked_time = env.block.time.seconds() - exists[i].last_time;
        let mut reward_tot = Uint128::zero();

        if staked_time < exists[i].lock_type {
            reward_tot = Uint128::zero();
        } else {
            match exists[i].lock_type {
                constants::DAYS_30_SECONDS => {
                    if staked_time >= constants::DAYS_30_SECONDS {
                        // 10.25% for over 30 days
                        reward_tot = exists[i].amount * Uint128::from(constants::DAYS_30_APY)
                            / Uint128::from(MULTIPLE);
                    }
                }
                constants::DAYS_60_SECONDS => {
                    if staked_time >= constants::DAYS_60_SECONDS {
                        // 10.25% for over 30 days
                        reward_tot = exists[i].amount * Uint128::from(constants::DAYS_60_APY)
                            / Uint128::from(MULTIPLE);
                    }
                }
                constants::DAYS_90_SECONDS => {
                    if staked_time >= constants::DAYS_90_SECONDS {
                        // 10.25% for over 30 days
                        reward_tot = exists[i].amount * Uint128::from(constants::DAYS_90_APY)
                            / Uint128::from(MULTIPLE);
                    }
                }
                constants::DAYS_120_SECONDS => {
                    if staked_time >= constants::DAYS_120_SECONDS {
                        // 10.25% for over 30 days
                        reward_tot = exists[i].amount * Uint128::from(constants::DAYS_120_APY)
                            / Uint128::from(MULTIPLE);
                    }
                }
                constants::DAYS_180_SECONDS => {
                    if staked_time >= constants::DAYS_180_SECONDS {
                        // 10.25% for over 30 days
                        reward_tot = exists[i].amount * Uint128::from(constants::DAYS_180_APY)
                            / Uint128::from(MULTIPLE);
                    }
                }
                constants::DAYS_240_SECONDS => {
                    if staked_time >= constants::DAYS_240_SECONDS {
                        // 10.25% for over 30 days
                        reward_tot = exists[i].amount * Uint128::from(constants::DAYS_240_APY)
                            / Uint128::from(MULTIPLE);
                    }
                }
                constants::DAYS_360_SECONDS => {
                    if staked_time >= constants::DAYS_360_SECONDS {
                        // 10.25% for over 30 days
                        reward_tot = exists[i].amount * Uint128::from(constants::DAYS_360_APY)
                            / Uint128::from(MULTIPLE);
                    }
                }
                _ => {
                    if staked_time >= constants::DAYS_720_SECONDS {
                        // 10.25% for over 30 days
                        reward_tot = exists[i].amount * Uint128::from(constants::DAYS_720_APY)
                            / Uint128::from(MULTIPLE);
                    }
                }
            }
            exists[i].last_time = env.block.time.seconds();
        }
        let reward = reward_tot * (Uint128::from(cfg.reward_interval))
            / (Uint128::from(constants::ONE_YEAR_SECONDS));
        exists[i].reward = reward * Uint128::from(staked_time) / Uint128::from(cfg.reward_interval); //for test
        total_reward += exists[i].reward;
    }

    STAKERS.save(storage, address.clone(), &exists).unwrap();

    return Ok(total_reward);
}
///////////////////////////////////////////////////////// this func is called when we click reward button on frontend//////////////////////////////////
///
///         input params: customer's wallet address
///                       juno reward flag(This is true when rank is bigger than 500, if this is true, customer can get juno reward, if false, cutomer can get only hole reward)
///                       artists wallet percent
///                       burn wallet percent
///                       charity wallet percent
///                       my wallet percent = 100 - artists_percent - burn_percent - charity_percent
///
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
pub fn execute_claim_reward(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
) -> Result<Response, ContractError> {
    check_enabled(&deps, &info)?;
    let mut cfg = CONFIG.load(deps.storage)?;

    let reward = update_reward(deps.storage, env.clone(), info.sender.clone()).unwrap();

    let mut list = STAKERS
        .load(deps.storage, info.sender.clone())
        .unwrap_or(vec![]);

    if reward == Uint128::zero() {
        return Err(ContractError::NoReward {});
    }
    if cfg.reward_amount < reward {
        return Err(ContractError::NotEnoughReward {});
    }

    cfg.reward_amount -= Uint128::from(reward);
    CONFIG.save(deps.storage, &cfg)?;

    for i in 0..list.len() {
        list[i].reward = Uint128::zero();
        // list[i].last_time = env.block.time.seconds();
    }
    STAKERS.save(deps.storage, info.sender.clone(), &list)?;

    let exec_cw20_transfer = WasmMsg::Execute {
        contract_addr: cfg.rize_token_address.clone().into(),
        msg: to_binary(&Cw20ExecuteMsg::Transfer {
            recipient: info.sender.clone().into(),
            amount: Uint128::from(reward),
        })?,
        funds: vec![],
    };

    // End

    return Ok(Response::new().add_message(exec_cw20_transfer).add_attributes(vec![
        attr("action", "claim_reward"),
        attr("address", info.sender.clone()),
        attr("reward_amount", Uint128::from(reward)),
    ]));
}
///////////////////////////////////////////////////////// this func is called when we click unstake button on frontend//////////////////////////////////
///
///         Using this function, we can unstake all staked token
///         input params: none
///         
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
pub fn execute_unstake(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    index: u64,
    amount: Uint128,
) -> Result<Response, ContractError> {
    check_enabled(&deps, &info)?;
    let mut cfg = CONFIG.load(deps.storage)?;

    let mut list = STAKERS.load(deps.storage, info.sender.clone())?;
    let i = index as usize;
    if list.len() <= i {
        return Err(ContractError::NoStaked {});
    }
    
    if amount == Uint128::zero() {
        return Err(ContractError::InvalidInput {});
    }
    if list[i].amount < amount {
        return Err(ContractError::NotEnoughStake {});
    }
    if cfg.stake_amount < amount {
        return Err(ContractError::NotEnoughStake {});
    }
    if env.block.time.seconds() - list[i].last_time < list[i].lock_type {
        return Err(ContractError::StillLocked {});
    }

    cfg.stake_amount -= amount;
    CONFIG.save(deps.storage, &cfg)?;

    list[i].amount -= amount;
    if list[i].amount == Uint128::zero() {
        list.remove(index as usize);
    }

    STAKERS.save(deps.storage, info.sender.clone(), &list)?;
    
    let exec_cw20_transfer = WasmMsg::Execute {
        contract_addr: cfg.rize_token_address.clone().into(),
        msg: to_binary(&Cw20ExecuteMsg::Transfer {
            recipient: info.sender.clone().into(),
            amount: Uint128::from(amount),
        })?,
        funds: vec![],
    };

    return Ok(Response::new().add_message(exec_cw20_transfer).add_attributes(vec![
        attr("action", "unstake"),
        attr("address", info.sender.clone()),
        attr("unstake_amount", Uint128::from(amount)),
    ]));
}

///////////////////////////////////////////////////////// this func is called for checking ownership//////////////////////////////////
///
///         Owner is set when contract is instantiated.
///         Using this function, we can authorize the ownership
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
pub fn check_owner(deps: &DepsMut, info: &MessageInfo) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;

    if info.sender != cfg.owner {
        return Err(ContractError::Unauthorized {});
    }
    Ok(Response::new().add_attribute("action", "check_owner"))
}
///////////////////////////////////////////////////////// this func is called for checking enable state//////////////////////////////////
///
///         Enable state is set when contract is instantiated.
///         The default vale is true.
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

pub fn check_enabled(deps: &DepsMut, _info: &MessageInfo) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    if !cfg.enabled {
        return Err(ContractError::Disabled {});
    }
    Ok(Response::new().add_attribute("action", "check_enabled"))
}
///////////////////////////////////////////////////////// this func is called for updating the ownership//////////////////////////////////
///
///         Owner is set when contract is instantiated.
///         if changing ownership is needed, we can use this function.
///         input params: new owner(new walletaddress)
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

pub fn execute_update_owner(
    deps: DepsMut,
    info: MessageInfo,
    owner: Addr,
) -> Result<Response, ContractError> {
    // authorize owner
    check_owner(&deps, &info)?;

    CONFIG.update(deps.storage, |mut exists| -> StdResult<_> {
        exists.owner = owner;
        Ok(exists)
    })?;
    Ok(Response::new().add_attribute("action", "update_owner"))
}
///////////////////////////////////////////////////////// this func is called for updating the enable state //////////////////////////////////
///
///         If we need changing the enable state of the contract, this function is used.
///         input params: new state(BOOL)
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

pub fn execute_update_enabled(
    deps: DepsMut,
    info: MessageInfo,
    enabled: bool,
) -> Result<Response, ContractError> {
    // authorize owner
    check_owner(&deps, &info)?;

    CONFIG.update(deps.storage, |mut exists| -> StdResult<_> {
        exists.enabled = enabled;
        Ok(exists)
    })?;
    Ok(Response::new().add_attribute("action", "update_enabled"))
}
///////////////////////////////////////////////////////// this func is called for updating reward interval //////////////////////////////////
///
///         If we need changing reward interval, this function is used.
///         input params: new reward_interval(u64)
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

pub fn execute_update_constants(
    deps: DepsMut,
    info: MessageInfo,
    rize_token_address: Addr,
    reward_interval: u64,
) -> Result<Response, ContractError> {
    // authorize owner
    check_owner(&deps, &info)?;

    CONFIG.update(deps.storage, |mut exists| -> StdResult<_> {
        exists.rize_token_address = rize_token_address;
        exists.reward_interval = reward_interval;
        Ok(exists)
    })?;

    Ok(Response::new().add_attribute("action", "update_constants"))
}
///////////////////////////////////////////////////////// this func is called for withdrawing reward //////////////////////////////////
///
///         If withdrawing the reward tokens is needed, this function is used.
///         Only owner can call this function
///         input pararms: the reward token amount of withdrawing
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

pub fn execute_withdraw_reward(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    amount: Uint128,
) -> Result<Response, ContractError> {
    check_owner(&deps, &info)?;

    let mut cfg = CONFIG.load(deps.storage)?;
    let reward_amount = cfg.reward_amount;
    if reward_amount < amount {
        return Err(ContractError::NotEnoughReward {});
    }

    cfg.reward_amount -= amount;
    CONFIG.save(deps.storage, &cfg)?;

    // create transfer cw20 msg
    let exec_cw20_transfer = WasmMsg::Execute {
        contract_addr: cfg.rize_token_address.clone().into(),
        msg: to_binary(&Cw20ExecuteMsg::Transfer {
            recipient: info.sender.clone().into(),
            amount: Uint128::from(amount),
        })?,
        funds: vec![],
    };

    return Ok(Response::new().add_message(exec_cw20_transfer).add_attributes(vec![
        attr("action", "withdraw_reward"),
        attr("address", info.sender.clone()),
        attr("amount", amount),
    ]));
}
///////////////////////////////////////////////////////// this func is called for withdrawing the staked token //////////////////////////////////
///
///         Only owner can call this function
///         input pararms: the withdraw amount
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
pub fn execute_withdraw_stake(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    amount: Uint128,
) -> Result<Response, ContractError> {
    check_owner(&deps, &info)?;

    let mut cfg = CONFIG.load(deps.storage)?;
    let stake_amount = cfg.stake_amount;
    if stake_amount < amount {
        return Err(ContractError::NotEnoughStake {});
    }

    cfg.stake_amount -= amount;
    CONFIG.save(deps.storage, &cfg)?;

    // create transfer cw20 msg
    let exec_cw20_transfer = WasmMsg::Execute {
        contract_addr: cfg.rize_token_address.clone().into(),
        msg: to_binary(&Cw20ExecuteMsg::Transfer {
            recipient: info.sender.clone().into(),
            amount: Uint128::from(amount),
        })?,
        funds: vec![],
    };

    return Ok(Response::new().add_message(exec_cw20_transfer).add_attributes(vec![
        attr("action", "withdraw_stake"),
        attr("address", info.sender.clone()),
        attr("amount", amount),
    ]));
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_binary(&query_config(deps)?),
        QueryMsg::Staker { address } => to_binary(&query_staker(deps, address)?),
        QueryMsg::ListStakers { start_after } => to_binary(&query_list_stakers(deps, start_after)?)
    }
}
///////////////////////////////////////////////////////// this func is called for getting the state of the contract  //////////////////////////////////
///
///         
///         Using this function, we can get the contract informatios such as owner, reward token denom, stake token address,
///         reward interval, artists, burn, charity address for reward, enable state.
///          
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
pub fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let cfg = CONFIG.load(deps.storage)?;
    Ok(ConfigResponse {
        owner: cfg.owner,
        rize_token_address: cfg.rize_token_address.into(),
        reward_amount: cfg.reward_amount,
        stake_amount: cfg.stake_amount,
        reward_interval: cfg.reward_interval,
        enabled: cfg.enabled,
    })
}
///////////////////////////////////////////////////////// this func is called for getting the hole token amout  //////////////////////////////////
///
///         
///         Using this function, we can get the whole amout of the hole token in the contract.
///         input params: contract address or wallet address
///     
/// ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// pub fn query_get_hole_amount(deps: Deps, address: Addr) -> StdResult<TestBalanceResponse> {
//     let cfg = CONFIG.load(deps.storage)?;

//     let total = util::get_token_amount(
//         deps.querier,
//         Denom::Cw20(cfg.stake_token_address.clone()),
//         address.clone(),
//     )
//     .unwrap();
//     Ok(TestBalanceResponse { balance: total })
// }
///////////////////////////////////////////////////////// this func is called for getting the informations of stakers  //////////////////////////////////
///
///         
///         Using this function, we can get anybody's all staking informations.
///         input params: contract address or wallet address
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

fn query_staker(deps: Deps, address: Addr) -> StdResult<Vec<StakerInfo>> {
    let list = STAKERS
        .load(deps.storage, address.clone())
        .unwrap_or(vec![]);
    Ok(list)
}

fn map_staker(item: StdResult<(Addr, Vec<StakerInfo>)>) -> StdResult<Vec<StakerInfo>> {
    item.map(|(_id, record)| record)
}
///////////////////////////////////////////////////////// this func is called for getting the informations of all stakers  //////////////////////////////////
///
///         
///         Using this function, we can get all staking informations for all stakers.
///         input params: start wallet address for getting the list of stakers.
///     
/// /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
fn query_list_stakers(deps: Deps, start_after: Option<String>) -> StdResult<StakerListResponse> {
    let addr = maybe_addr(deps.api, start_after)?;
    let start = addr.map(|addr| Bound::exclusive(addr.clone()));

    let stakers: StdResult<Vec<Vec<_>>> = STAKERS
        .range(deps.storage, start, None, Order::Ascending)
        .map(|item| map_staker(item))
        .collect();

    Ok(StakerListResponse { stakers: stakers? })
}
///////////////////////////////////////////////////////// this func is called for migration of the contract  //////////////////////////////////
///
///         
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
#[cfg_attr(not(feature = "library"), entry_point)]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    let version = get_contract_version(deps.storage)?;
    if version.contract != CONTRACT_NAME {
        return Err(ContractError::CannotMigrate {
            previous_contract: version.contract,
        });
    }
    Ok(Response::default())
}
