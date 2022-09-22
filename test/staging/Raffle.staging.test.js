const { assert, expect } = require("chai")
const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

developmentChains.includes(network.name) ? describe.skip : describe("Raffle Unit Tests", async function () {
   
   let raffle, entranceFee, deployer
   
   beforeEach(async function () {
      deployer = (await getNamedAccounts()).deployer
      raffle = await ethers.getContract("Raffle", deployer)
      entranceFee = await raffle.getEntranceFee()
   })

   describe("fulfillRandomWords", function () {
      it("Works live with Chainlink Keepers and Chainlink VRF & we got a random winner", async function () {
         console.log("Setting up test...")

         const startingTimeStamp = await raffle.getLatestTimestamp()
         const accounts = await ethers.getSigners()

         console.log("Setting up Listener...")
         await new Promise(async (resolve, reject) => {
            raffle.once("WinnerPicked", async () => {
               console.log("WinnerPicked event fired!")

               try {
                  const recentWinner = await raffle.getRecentWinner()
                  const winnerEndingBalance = await accounts[0].getBalance() 
                  const raffleState = await raffle.getRaffleState()
                  const recentTimeStamp = await raffle.getLatestTimestamp()

                  await expect(raffle.getPlayer(0)).to.be.reverted
                  assert.equal(recentWinner.toString(), accounts[0].address)
                  assert.equal(raffleState, 0)
                  assert.equal(winnerEndingBalance.toString(), (winnerStartingBalance.add(entranceFee)).toString())
                  assert(recentTimeStamp > startingTimeStamp)

                  resolve()
               } catch (error) {
                  console.log(error)
                  reject(error)
               }
            })

            console.log("Entering Raffle...")
            const tx = await raffle.enterRaffle({ value: entranceFee })
            await tx.wait(1)

            console.log("Ok, time to wait...")
            const winnerStartingBalance = await accounts[0].getBalance()
         })
      })
   })
})