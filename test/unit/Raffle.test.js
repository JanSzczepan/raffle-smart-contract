const { assert, expect } = require("chai")
const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name) ? describe.skip : describe("Raffle Unit Tests", async function () {
   
   let raffle, vrfCoordinatorV2Mock, entranceFee, deployer, interval
   const chainId = network.config.chainId
   
   beforeEach(async function () {
      deployer = (await getNamedAccounts()).deployer
      await deployments.fixture(["all"])

      raffle = await ethers.getContract("Raffle", deployer)
      vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
      entranceFee = await raffle.getEntranceFee()
      interval = await raffle.getInterval()
   })

   describe("constructor", function () {
      it("Initializes Raffle contract properly", async function () {
         const raffleState = await raffle.getRaffleState()

         assert.equal(raffleState.toString(), "0")
         assert.equal(interval.toString(), networkConfig[chainId]["interval"])
      })
   })

   describe("enterRaffle", function () {
      it("Reverts when you don't pay enough", async function () {
         await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__SendMoreToEnterRaffle")
      })

      it("Doesn't allow to enter raffle when calculating", async function () {
         await raffle.enterRaffle({ value: entranceFee })
         
         await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
         await network.provider.send("evm_mine", [])
         
         await raffle.performUpkeep([])

         await expect(raffle.enterRaffle({ value: entranceFee })).to.be.revertedWith("Raffle__NotOpen")
      })

      it("Records player when they enter", async function () {
         await raffle.enterRaffle({ value: entranceFee })
         const player = await raffle.getPlayer(0)

         assert.equal(player, deployer)
      })

      it("Emits Event on enter", async function () {
         await expect(raffle.enterRaffle({ value: entranceFee })).to.be.emit(raffle, "RaffleEnter")
      })
   })

   describe("checkUpkeep", function () {
      it("Returns false if people sent any ETH", async function () {
         network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
         network.provider.send("evm_mine", [])   
         
         const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
         
         assert(!upkeepNeeded)
      })

      it("Returns false if Raffle isn't open", async function () {
         await raffle.enterRaffle({ value: entranceFee })

         network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
         network.provider.send("evm_mine", [])  

         await raffle.performUpkeep([])

         const raffleState = await raffle.getRaffleState()
         const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
      
         assert.equal(raffleState.toString(), "1")
         assert(!upkeepNeeded)
      })

      it("returns false if enough time hasn't passed", async () => {
         await raffle.enterRaffle({ value: entranceFee })
         
         await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
         await network.provider.request({ method: "evm_mine", params: [] })
         
         const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
         
         assert(!upkeepNeeded)
      })

      it("returns true if enough time has passed, has players, eth, and is open", async () => {
         await raffle.enterRaffle({ value: entranceFee })
         
         await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
         await network.provider.request({ method: "evm_mine", params: [] })
         
         const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
         
         assert(upkeepNeeded)
      })
   })

   describe("performUpkeep", function () {
      it("Only runs when checkUpkeep returns true", async function () {
         await raffle.enterRaffle({ value: entranceFee })
         
         await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
         await network.provider.send("evm_mine", [])
         
         const tx = await raffle.performUpkeep([])
         
         assert(tx)
      })

      it("Reverts when checkUpkeep is false", async function () {
         await expect(raffle.performUpkeep([])).to.be.revertedWith("Raffle__UpkeepNotNeeded")
      })

      it("Updates the Raffle state, emits the event and calls the vrfCoordinator", async function () {
         await raffle.enterRaffle({ value: entranceFee })
         
         await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
         await network.provider.send("evm_mine", [])
         
         const txResponse = await raffle.performUpkeep([])
         const txReceipt = await txResponse.wait(1)
         const requestId = txReceipt.events[1].args.requestId

         const raffleState = await raffle.getRaffleState()

         assert(requestId.toNumber() > 0)
         assert.equal(raffleState.toString(), "1")
      })
   })

   describe("fulfillRandomWords", function () {
      beforeEach(async function () {
         await raffle.enterRaffle({ value: entranceFee })
         
         await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
         await network.provider.send("evm_mine", [])
      })

      it("Can only be called after performUpkeep", async function () {
         await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)).to.be.revertedWith("nonexistent request")               
         await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)).to.be.revertedWith("nonexistent request")               
      })

      it("Picks the winner, resets the lottery and sends money", async function () {
         
         const additionalEntrants = 3
         const startingAccountIndex = 1
         const accounts = await ethers.getSigners()

         for(let i = startingAccountIndex; i < startingAccountIndex + additionalEntrants; i++) {
            const connectedRaffle = raffle.connect(accounts[i])            
            await connectedRaffle.enterRaffle({ value: entranceFee })
         }

         const startingTimeStamp = await raffle.getLatestTimestamp()

         await new Promise(async (resolve, reject) => {
            raffle.once("WinnerPicked", async () => {
               try {
                  const recentWinner = await raffle.getRecentWinner()
                  const winnerBalance = await accounts[1].getBalance()
                  const numOfPlayers = await raffle.getNumberOfPlayers() 
                  const raffleState = await raffle.getRaffleState()
                  const recentTimeStamp = await raffle.getLatestTimestamp()

                  assert.equal(recentWinner.toString(), accounts[1].address)
                  assert.equal(winnerBalance.toString(), startingWinnerBalance.add(entranceFee.mul(additionalEntrants).add(entranceFee)).toString())
                  assert.equal(numOfPlayers.toString(), "0")
                  assert.equal(raffleState.toString(), "0")
                  assert(recentTimeStamp > startingTimeStamp)
               
                  resolve()
               } catch (error) {
                  reject(error)
               }
            })

            const txResponse = await raffle.performUpkeep([])
            const txReceipt = await txResponse.wait(1)
            const startingWinnerBalance = await accounts[1].getBalance()
            const requestId = txReceipt.events[1].args.requestId
            await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, raffle.address)
         })
         
         // const startingDeployerBalance = await ethers.provider.getBalance(deployer)
         // const startingRaffleBalance = await raffle.provider.getBalance(raffle.address)

         // const txResponse = await raffle.performUpkeep([])
         // const txReceipt = await txResponse.wait(1)
         // const requestId = txReceipt.events[1].args.requestId
         // const { effectiveGasPrice: effectiveGasPrice1, gasUsed: gasUsed1 } = txReceipt
         // const gasCost1 = effectiveGasPrice1.mul(gasUsed1)

         // const txResponse2 = await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, raffle.address)
         // const txReceipt2 = await txResponse2.wait(1)
         // const { effectiveGasPrice: effectiveGasPrice2, gasUsed: gasUsed2 } = txReceipt2
         // const gasCost2 = effectiveGasPrice2.mul(gasUsed2)

         // const winner = await raffle.getRecentWinner()
         // const playersArr = await raffle.getNumberOfPlayers()
         // const endingDeployerBalance = await ethers.provider.getBalance(deployer)
         // const endingRaffleBalance = await raffle.provider.getBalance(raffle.address)

         // // console.log('deployer', 'start:', startingDeployerBalance.toString(), 'end:', endingDeployerBalance.toString())
         // // console.log('raffle', 'start:', startingRaffleBalance.toString(), 'end:', endingRaffleBalance.toString())
         // assert.equal(winner, deployer)
         // assert.equal(playersArr, 0)
         // assert.equal(endingRaffleBalance.toString(), "0")
         // assert.equal(((startingRaffleBalance.sub(gasCost1)).sub(gasCost2)).toString(), (endingDeployerBalance.sub(startingDeployerBalance)).toString())
      })
   })
})