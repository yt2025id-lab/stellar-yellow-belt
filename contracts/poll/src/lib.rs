#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec, String, Address};

const OPTIONS: u32 = 6;

#[contract]
pub struct LivePoll;

fn key_question(env: &Env) -> Symbol { Symbol::new(env, "question") }
fn key_total(env: &Env) -> Symbol { Symbol::new(env, "total") }

fn key_votes(env: &Env, id: u32) -> Symbol {
    match id {
        0 => Symbol::new(env, "votes0"),
        1 => Symbol::new(env, "votes1"),
        2 => Symbol::new(env, "votes2"),
        3 => Symbol::new(env, "votes3"),
        4 => Symbol::new(env, "votes4"),
        5 => Symbol::new(env, "votes5"),
        _ => Symbol::new(env, "bad"),
    }
}

fn key_option(env: &Env, id: u32) -> Symbol {
    match id {
        0 => Symbol::new(env, "opt0"),
        1 => Symbol::new(env, "opt1"),
        2 => Symbol::new(env, "opt2"),
        3 => Symbol::new(env, "opt3"),
        4 => Symbol::new(env, "opt4"),
        5 => Symbol::new(env, "opt5"),
        _ => Symbol::new(env, "bad"),
    }
}

#[contractimpl]
impl LivePoll {
    pub fn init(
        env: Env,
        question: String,
        opt0: String,
        opt1: String,
        opt2: String,
        opt3: String,
        opt4: String,
        opt5: String,
    ) {
        if env.storage().instance().has(&key_question(&env)) {
            panic!("Poll already initialized");
        }
        env.storage().instance().set(&key_question(&env), &question);
        env.storage().instance().set(&key_option(&env, 0), &opt0);
        env.storage().instance().set(&key_option(&env, 1), &opt1);
        env.storage().instance().set(&key_option(&env, 2), &opt2);
        env.storage().instance().set(&key_option(&env, 3), &opt3);
        env.storage().instance().set(&key_option(&env, 4), &opt4);
        env.storage().instance().set(&key_option(&env, 5), &opt5);
        env.storage().instance().set(&key_total(&env), &0u32);
    }

    pub fn cast_vote(env: Env, voter: Address, option_id: u32) -> u32 {
        if env.storage().instance().has(&voter) {
            panic!("Already voted");
        }
        if option_id >= OPTIONS {
            panic!("Invalid option");
        }

        let key = key_votes(&env, option_id);
        let current: u32 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(current + 1));

        let total: u32 = env.storage().instance().get(&key_total(&env)).unwrap_or(0);
        env.storage().instance().set(&key_total(&env), &(total + 1));

        env.storage().instance().set(&voter, &true);

        current + 1
    }

    pub fn get_question(env: Env) -> String {
        env.storage()
            .instance()
            .get(&key_question(&env))
            .unwrap_or(String::from_str(&env, ""))
    }

    pub fn get_option(env: Env, option_id: u32) -> String {
        env.storage()
            .instance()
            .get(&key_option(&env, option_id))
            .unwrap_or(String::from_str(&env, ""))
    }

    pub fn get_votes(env: Env, option_id: u32) -> u32 {
        env.storage()
            .instance()
            .get(&key_votes(&env, option_id))
            .unwrap_or(0)
    }

    pub fn get_total_votes(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&key_total(&env))
            .unwrap_or(0)
    }

    pub fn get_results(env: Env) -> Vec<u32> {
        let mut results = Vec::new(&env);
        for i in 0..OPTIONS {
            results.push_back(
                env.storage()
                    .instance()
                    .get(&key_votes(&env, i))
                    .unwrap_or(0),
            );
        }
        results
    }

    pub fn has_voted(env: Env, voter: Address) -> bool {
        env.storage().instance().has(&voter)
    }
}

mod test;
