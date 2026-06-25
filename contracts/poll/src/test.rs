#![cfg(test)]

use super::*;
use soroban_sdk::{vec, Env, String};
use soroban_sdk::testutils::Address as _;

fn setup() -> (Env, LivePollClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let contract_id = env.register(LivePoll, ());
    let client = LivePollClient::new(&env, &contract_id);

    client.init(
        &String::from_str(&env, "Best Blockchain?"),
        &String::from_str(&env, "Stellar"),
        &String::from_str(&env, "Solana"),
        &String::from_str(&env, "Ethereum"),
        &String::from_str(&env, "Polygon"),
        &String::from_str(&env, "Sui"),
        &String::from_str(&env, "ICP"),
    );

    (env, client, user1, user2)
}

#[test]
fn test_live_poll() {
    let (env, client, user1, user2) = setup();

    assert_eq!(
        client.get_question(),
        String::from_str(&env, "Best Blockchain?")
    );
    assert_eq!(
        client.get_option(&0),
        String::from_str(&env, "Stellar")
    );
    assert_eq!(client.get_total_votes(), 0);

    let r = client.cast_vote(&user1, &0);
    assert_eq!(r, 1);
    assert_eq!(client.get_votes(&0), 1);
    assert_eq!(client.get_total_votes(), 1);
    assert!(client.has_voted(&user1));

    client.cast_vote(&user2, &4);
    assert_eq!(client.get_votes(&4), 1);
    assert_eq!(client.get_total_votes(), 2);

    let results = client.get_results();
    assert_eq!(results, vec![&env, 1u32, 0u32, 0u32, 0u32, 1u32, 0u32]);
}

#[test]
#[should_panic(expected = "Already voted")]
fn test_double_vote() {
    let (env, client, user1, _) = setup();
    env.mock_all_auths();
    client.cast_vote(&user1, &0);
    env.mock_all_auths();
    client.cast_vote(&user1, &0);
}

#[test]
#[should_panic(expected = "Invalid option")]
fn test_invalid_option() {
    let (env, client, user1, _) = setup();
    env.mock_all_auths();
    client.cast_vote(&user1, &99);
}
