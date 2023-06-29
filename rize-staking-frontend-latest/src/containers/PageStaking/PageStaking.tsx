import React from "react";
import StakingMain from "containers/PageStaking/StakingMain"
import { Helmet } from "react-helmet";
import StakingBg from "images/staking/stakingBg.png"
function PageStaking() {
  return (
    <>
      <Helmet>
        <title>Staking || Rize2Day </title>
      </Helmet>

      <div className="nc-PageStaking relative overflow-x-clip min-h-[680px]">
        <div className="absolute  w-full h-full">
          <img className="absolute w-full h-full z-0" src={StakingBg} alt="" />
          <div className="absolute w-full h-full bg-[#33FF00] mix-blend-multiply z-0" />
          <div className={"absolute bg-[#33FF00] opacity-40 blur-[100px] w-[20vw] h-2/3 rounded-full -top-[100px] -left-[120px] z-0"}></div>
          <div className={"absolute bg-[#33FF00] opacity-40 blur-[100px] w-[20vw] h-2/3 rounded-full bottom-[0px] -right-[120px] z-0"}></div>
        </div>
        <StakingMain />
      </div>
    </>
  );
}

export default PageStaking;
