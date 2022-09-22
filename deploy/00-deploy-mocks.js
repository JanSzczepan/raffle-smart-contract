const { network } = require("hardhat")
const { developmentChains } = require("../helper-hardhat-config")

const BASE_FEE = "250000000000000000"
const GAS_PRICE_LINK = 1e9

module.exports = async function ({ getNamedAccounts, deployments }) {
   const { deploy, log } = deployments
   const { deployer } = await getNamedAccounts()

   if(developmentChains.includes(network.name)) {
      log('Local network detected. Deploying mocks...')

      await deploy('VRFCoordinatorV2Mock', {
         from: deployer,
         args: [BASE_FEE, GAS_PRICE_LINK],
         log: true
      })

      log("Mocks Deployed!")
      log("----------------------------------------------------------")
   }
}

module.exports.tags = ['all', 'mocks']