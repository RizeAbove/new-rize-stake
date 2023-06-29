import { FC, useState, useEffect, useRef, MouseEvent, Fragment } from "react";
import { toast } from "react-toastify";
import ButtonPrimaryWide from "shared/Button/ButtonPrimaryWide";
import ButtonSecondary from "shared/Button/ButtonSecondary";
import { useSigningClient } from "app/cosmwasm";

import CircularProgress from '@mui/material/CircularProgress';
import Backdrop from '@mui/material/Backdrop';
import { Dialog, Popover, Transition } from "@headlessui/react";
import { secondsToDHM } from "utils/utils";
export interface StakingMainProps {
    className?: string;
}

const durationList = [{ time: 30, apy: 10 }, { time: 60, apy: 20 }, { time: 90, apy: 35 }, { time: 120, apy: 50 }, { time: 180, apy: 65 }, { time: 240, apy: 90 }, { time: 360, apy: 148 }, { time: 720, apy: 180 }]

const LOCK_TIME = {
    2592000: "30 Days",
    5184000: "60 Days",
    7776000: "90 Days",
    10368000: "120 Days",
    15552000: "180 Days",
    20736000: "240 Days",
    31104000: "360 Days",
    62208000: "720 Days"
}

const RIZE_PRICE = 0.3;

const StakingMain: FC<StakingMainProps> = ({
    className = "",
}) => {
    const {
        client,
        signingClient,
        loadClient,
        connectWallet,
        walletAddress,
        getTokenBalance,
        balances,
        stakingInfo,
        executeStake,
        executeReward,
        executeUnstake,
    }: any = useSigningClient();
    console.log("wallet address =======================> ", walletAddress);
    console.log("balances ==========================>", balances);
    console.log("staking info ==========================>", stakingInfo);
    // console.log("wallet object *************** ", window)

    const [loadingView, setLoadingView] = useState(false);
    const [apyIndex, setApyIndex] = useState(0);
    const [stakingAmount, setStakingAmount] = useState("");
    const [termsChecked, setTermsChecked] = useState(true);
    const [lockPercent, setLockPercent] = useState("");
    const [isStakeManageDlg, setStakeManageDlg] = useState(false);
    const [unstakeIndex, setUnstakeIndex] = useState(0);
    const [unstakingAmount, setUnstakingAmount] = useState("");

    console.log("unstake index ===============================>", unstakeIndex);

    useEffect(() => {
        const percent = balances.locked * 100 / (balances.locked + balances.cw20);
        setLockPercent(percent.toFixed(2));
    }, [balances.locked, balances.cw20]);

    const selectMaxAmount = async () => {
        console.log("selectMaxAmount log - 1 ", balances?.cw20);
        setStakingAmount(balances?.cw20);
    }

    const selectMaxUnstakingAmount = async () => {
        console.log("selectMaxUnstakingAmount log - 1 ", stakingInfo[unstakeIndex]?.amount);
        setUnstakingAmount(stakingInfo[unstakeIndex]?.amount);
    }

    const handleStake = async () => {
        if (!signingClient || walletAddress.length === 0) {
            toast.warn("Wallet not connected")
            return
        }

        if (!stakingAmount) {
            toast.warn("Staking amount is not set")
            return
        }

        setLoadingView(true)
        await executeStake(stakingAmount, apyIndex);
        setLoadingView(false)
    }

    const handleClaimReward = async () => {
        if (!signingClient || walletAddress.length === 0) {
            toast.warn("Wallet not connected")
            return
        }

        if (balances?.reward < 0.000001) {
            toast.error("No claimable reward")
            return
        }

        setLoadingView(true)
        await executeReward(stakingAmount, apyIndex);
        setLoadingView(false)
    }

    const handleUnstake = async () => {
        if (!signingClient || walletAddress.length === 0) {
            toast.warn("Wallet not connected")
            return
        }

        if (!unstakingAmount) {
            toast.warn("Unstaking amount is not set")
            return
        }

        setLoadingView(true)
        await executeUnstake(unstakeIndex, unstakingAmount);
        setLoadingView(false)
    }

    const tokenPrice = (amount) => {
        return (amount * RIZE_PRICE).toFixed(2);
    }

    return (
        <>
            <div className={`container h-full py-10 ${className} font-['GRIFTER']`}>
                <div className="relative h-full py-4 px-4 rounded-2xl bg-[#313631] flex justify-center items-center md:items-start flex-col md:flex-row  space-y-4 md:space-y-0  divide-dashed divide-x divide-[#A3A3A3]">
                    <div className="w-full md:w-[60%] h-full space-y-10 px-4">
                        <div className="font-bold text-[40px] leading-[100%] text-white">Lock Rize</div>

                        <div className="space-y-4">
                            <div >
                                <div className="font-bold text-[28px] leading-[100%] text-white">Duration</div>
                            </div>
                            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                                {
                                    durationList.map((item, index) => {
                                        let selectedTextClass = index == apyIndex ? "text-[#33FF00]" : "text-white"
                                        let selectedBorderClass = index == apyIndex ? "border-[#33FF00]" : "border-white"
                                        let selectedTextClass1 = index == apyIndex ? "text-[#33FF00]" : "text-[#7B7B7B]"
                                        return (<div className={`group cursor-pointer cols-span-1 flex flex-col items-center justify-center rounded-xl h-[134px] border ${selectedTextClass} ${selectedBorderClass} hover:border-[#33FF00] hover:text-[#33FF00] space-y-4`} onClick={() => setApyIndex(index)}>
                                            <div className="relative text-[24px] md:text-[48px] leading-[100%]">
                                                {item.time}
                                                <div className={`absolute text-[12px] md:text-[20px] ${selectedTextClass1} group-hover:text-[#33FF00] leading-[100%] -right-[10px] -top-[10px]`}>D</div>
                                            </div>
                                            <div className={`text-[20px] ${selectedTextClass1} group-hover:text-[#33FF00] leading-[100%]`}>{item.apy / 100}x</div>
                                        </div>)
                                    })
                                }
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="relative  text-[20px] font-bold ">
                                <input type="number"
                                    className="w-full rounded-xl border-white h-[60px]  text-white focus:border-white bg-transparent"
                                    placeholder="Enter Amount"
                                    value={stakingAmount}
                                    onChange={(event) => {
                                        if (event.target.value > balances.cw20) {
                                            return;
                                        }
                                        setStakingAmount(event.target.value.toString())
                                    }}
                                    max={balances.cw20}
                                />
                                <button className="absolute right-0 pr-4 top-0 text-[#33FF00] h-full flex items-center" onClick={selectMaxAmount}>Max</button>
                            </div>
                            <div className="">
                                <div className="font-bold text-[20px] leading-[100%] text-[#7B7B7B]">Available: <span className="text-[#33FF00]">{balances?.cw20}</span></div>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center space-x-8">
                                <input id="checked-checkbox" type="checkbox" defaultChecked={termsChecked} className="h-6 w-6 text-blue-600 bg-transparent border-[#AEAEB2] rounded" onChange={() => setTermsChecked(!termsChecked)} />
                                <label htmlFor="checked-checkbox" className="ml-2 text-xs md:text-[28px]  font-bold text-white leading-[100%]">I agree with <span className="text-[#33FF00]">Terms</span> and <span className="text-[#33FF00]">Privacy</span></label>
                            </div>
                        </div>

                        <div>
                            <ButtonPrimaryWide
                                className="w-full text-[#181B18] text-[20px] font-bold"
                                disabled={!termsChecked}
                                onClick={handleStake}
                            >
                                Confirm
                            </ButtonPrimaryWide>
                        </div>
                    </div>


                    <div className="w-full md:w-[40%] h-full space-y-7 px-4">
                        {/* <div className="space-y-4">
                            <div className="font-bold text-[28px] leading-[100%] text-white">My Tokens</div>
                            <div className="text-[15px] text-[#7B7B7B] leading-[100%]">Lock more Rize to increase your Voting Power</div>
                            <div className="rounded-xl bg-[#272727] flex flex-col items-center justify-content space-y-2 py-4 px-4">
                                <div className="w-full text-[13px] flex flex-row justify-between"><span className="text-white">Voting Power</span><span className="text-[#33FF00]">7047 (0.239%)</span></div>
                                <div className="w-full text-[15px] flex flex-row justify-end"><span className="text-white">241640.3484 Rize Locked</span></div>
                                <div className="w-full text-[13px] flex flex-row justify-between"><span className="text-[#101310] text-[16px]">Go Vote</span><span className="text-white text-[13px]">$593.26</span></div>
                            </div>
                        </div> */}

                        <div className="space-y-4">
                            <div className="font-bold text-[28px] leading-[100%] text-white">Locked Tokens</div>
                            <div className="rounded-xl bg-[#272727] flex flex-col items-center justify-content">
                                <div className="w-full text-[13px] flex flex-row justify-between rounded-t-xl bg-[#444647] py-4 px-4 grid grid-cols-3 text-center">
                                    <span className="text-white break-words">Locked</span>
                                    <span className="text-white break-words">Rebounding</span>
                                    <span className="text-white break-words">Unlocking</span>
                                </div>
                                <div className="w-full text-[13px] flex flex-row justify-between rounded-t-xl py-4 px-4 grid grid-cols-3 text-center">
                                    <span className="text-white break-words col-span-1">Locked:</span>
                                    <span className="text-white break-words col-span-2 flex flex-col"><span className="text-[#33FF00]">{balances.locked} Rize (~{tokenPrice(balances.locked)}$)</span><span className="text-white">({lockPercent}% of your total balance)</span></span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="font-bold text-[28px] text-white">Summary</div>
                            <div className="rounded-xl bg-[#272727] flex flex-col items-center justify-content h-[300px]">
                                <div className="w-full text-[13px] flex flex-row justify-between rounded-t-xl bg-[#444647] py-4 grid grid-cols-3 text-center">
                                    <span className="text-white break-words">Duration</span>
                                    <span className="text-white break-words">Locks</span>
                                    <span className="text-white break-words">Manage</span>
                                </div>
                                <div className="w-full h-full divide-dashed  divide-y divide-[#A3A3A3] overflow-y-auto">
                                    {
                                        (balances?.cw20 == 0 || !(signingClient || walletAddress.length === 0 ))?
                                            <div className="w-full h-full text-[15px] flex flex-row items-center justify-between  text-#33FF00 py-4 text-center">
                                                <p >"There is wallet connection issue or no available rize token to staking"</p>
                                            </div> :
                                            stakingInfo.map((item, index) => {
                                                return (
                                                    <div className="w-full text-[13px] flex flex-row justify-center py-4 grid grid-cols-3 text-center divide-dashed  divide-x divide-[#A3A3A3]">
                                                        <span className="flex items-center justify-center text-white break-words col-span-1">
                                                            {LOCK_TIME[item.lock_type]}
                                                        </span>
                                                        <span className="flex flex-col items-center justify-center text-white break-words col-span-1">
                                                            <span className="text-[#33FF00]">
                                                                {item.amount} Rize
                                                            </span>
                                                            <span className="text-white  break-words ">
                                                                ${tokenPrice(item.amount)}
                                                            </span>
                                                        </span>
                                                        <div className="flex items-center justify-end px-0 md:px-1">
                                                            <button
                                                                className="w-full h-[32px] flex items-center justify-center  text-black break-words rounded-xl bg-[rgba(47,237,0,0.58)] border-2 border-[#46FF18] col-span-1  text-[10px] md:text-[12px] xl:text-[15px]"
                                                                onClick={() => {
                                                                    setStakeManageDlg(true);
                                                                    setUnstakeIndex(index);
                                                                }}
                                                            >
                                                                Manage
                                                            </button>
                                                        </div>
                                                    </div>
                                                )
                                            })
                                    }
                                </div>
                            </div>
                        </div>

                        <div className="">
                            <ButtonPrimaryWide
                                className="w-full text-[#181B18] text-[20px] font-bold flex justify-between"
                                onClick={handleClaimReward}
                            >
                                <span>{balances?.reward == 0 ? "0" : balances?.reward?.toFixed(6)} Rize</span>
                                <span> Claim</span>
                            </ButtonPrimaryWide>
                        </div>
                    </div>
                </div>
            </div >

            <Dialog
                as="div"
                className="fixed inset-0 z-50  w-min h-min m-auto flex items-center py-8 px-8 rounded-2xl border-2 border-[#33FF00] bg-[#513631]"
                open={isStakeManageDlg}
                onClose={() => setStakeManageDlg(false)}
            >
                <div className="flex flex-col items-center justify-center space-y-8">
                    <p className="w-full h-full text-center text-[25px] font-[700]">Unstake</p>
                    <div className="relative  w-[300px] text-[20px] font-bold ">
                        <input type="number"
                            className="w-full rounded-xl border-white h-[60px]  text-white focus:border-white bg-transparent"
                            placeholder="Enter Amount"
                            value={stakingInfo[unstakeIndex]?.amount < unstakingAmount ? stakingInfo[unstakeIndex]?.amount : unstakingAmount}
                            onChange={(event) => {
                                if (event.target.value > stakingInfo[unstakeIndex]?.amount) {
                                    return;
                                }
                                setUnstakingAmount(event.target.value.toString())
                            }}
                            min={0}
                            max={stakingInfo[unstakeIndex]?.amount}
                        />
                        <button className="absolute right-0 pr-4 top-0 text-[#33FF00] h-full flex items-center" onClick={selectMaxUnstakingAmount}>Max</button>
                    </div>
                    {
                        !stakingInfo[unstakeIndex]?.canUnlock && (
                            <div className="">
                                <div className="font-bold text-[14px] text-[#FF3300]">You can unstake after {secondsToDHM(stakingInfo[unstakeIndex]?.lock_type - stakingInfo[unstakeIndex]?.staked_time)}</div>
                            </div>
                        )
                    }
                    <div>
                        <ButtonPrimaryWide
                            className="w-full text-[#181B18] text-[20px] font-bold"
                            onClick={handleUnstake}
                            disabled={!stakingInfo[unstakeIndex]?.canUnlock}
                        >
                            Confirm
                        </ButtonPrimaryWide>
                    </div>
                </div>
            </Dialog>

            <Backdrop
                sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
                open={loadingView}
            >
                <CircularProgress color="inherit" />
            </Backdrop>
        </>);
}
export default StakingMain;